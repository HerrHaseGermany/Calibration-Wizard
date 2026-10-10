import ast
import json
import re
from pathlib import Path

from calibration_wizard.api import create_app
from calibration_wizard.errors import Message
from calibration_wizard.printer import MockPrinter
from calibration_wizard.settings import Settings
from calibration_wizard.wizard import WizardError
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def test_backend_message_keys_and_parameters_exist_in_both_catalogs():
    catalogs = {
        language: json.loads((ROOT / f"frontend/assets/locales/{language}.json").read_text())
        for language in ("de", "en")
    }
    for path in (ROOT / "backend/src/calibration_wizard").glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            keywords = {item.arg: item.value for item in node.keywords}
            key_node = keywords.get("message_key")
            if not isinstance(key_node, ast.Constant):
                continue
            key = key_node.value
            params = keywords.get("message_params")
            names = {item.value for item in params.keys} if isinstance(params, ast.Dict) else set()
            for catalog in catalogs.values():
                assert key in catalog, key
                assert set(re.findall(r"\{(\w+)\}", catalog[key])) == names, key


def test_wizard_metadata_and_filament_errors_have_stable_keys():
    printer = MockPrinter()
    client = TestClient(create_app(Settings.from_env(), printer))
    definitions = client.get("/api/wizards")
    assert definitions.status_code == 200
    for definition in definitions.json():
        assert definition["name_key"] == f"wizards.{definition['id']}.name"
        assert definition["description_key"] == f"wizards.{definition['id']}.description"
    printer.data.print_state = "printing"
    response = client.post("/api/tools/filament/heat", json={"temperature": 210})
    assert response.status_code == 409
    assert response.json()["message_key"]
    assert response.json()["message_params"] == {}


def test_wrapped_errors_preserve_nested_labels_and_serialize_paths():
    label = Message(
        "Punkt 2 X", "setup.axis", label=Message("Punkt 2", "setup.point", index=2), axis="X"
    )
    error = WizardError(
        "Invalid coordinate",
        message_key="ui.value_is_not_a_valid_number",
        message_params={"label": label, "path": Path("/config/printer.cfg")},
    )
    wrapped = WizardError(error)
    assert str(wrapped) == "Invalid coordinate"
    assert wrapped.message_key == error.message_key
    assert wrapped.message_params["label"] == {
        "message_key": "setup.axis",
        "message_params": {
            "label": {"message_key": "setup.point", "message_params": {"index": 2}},
            "axis": "X",
        },
    }
    assert wrapped.message_params["path"] == "/config/printer.cfg"
    json.dumps(wrapped.message_params)
