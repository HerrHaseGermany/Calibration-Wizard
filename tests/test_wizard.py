import pytest
from calibration_wizard.models import WizardState
from calibration_wizard.printer import MockPrinter
from calibration_wizard.wizard import WIZARDS, ExtruderWizard, WizardError


def test_wizards_follow_calibration_dependency_order():
    assert [wizard.id for wizard in WIZARDS] == [
        "pid",
        "extruder",
        "bed_screws",
        "screws_tilt",
        "z_tilt",
        "quad_gantry_level",
        "probe_offset",
        "bed_mesh",
        "flow",
        "input_shaper",
        "pressure_advance",
    ]


async def heated_wizard():
    printer = MockPrinter()
    wizard = ExtruderWizard(printer)
    await wizard.start(120, 100)
    await wizard.heat(200)
    await printer.snapshot()
    await printer.snapshot()
    await wizard.ready()
    return wizard, printer


@pytest.mark.asyncio
async def test_complete_runtime_calibration_flow():
    wizard, printer = await heated_wizard()

    await wizard.extrude()
    assert wizard.session.state == WizardState.WAITING_FOR_MEASUREMENT
    await wizard.measurement(24)
    assert wizard.session.result.new_rotation_distance == pytest.approx(4.51776)
    await wizard.apply()

    assert wizard.session.state == WizardState.APPLIED
    assert printer.data.rotation_distance == pytest.approx(4.51776)
    assert printer.extrusions == [100]


@pytest.mark.asyncio
async def test_cold_extrusion_is_rejected():
    printer = MockPrinter()
    printer.heating_rate = 0
    wizard = ExtruderWizard(printer)
    await wizard.start(120, 100)
    await wizard.heat(200)

    with pytest.raises(WizardError, match="safe extrusion temperature"):
        await wizard.ready()


@pytest.mark.asyncio
async def test_temperature_requires_five_degree_steps():
    printer = MockPrinter()
    wizard = ExtruderWizard(printer)
    await wizard.start(120, 100)

    with pytest.raises(WizardError, match="5 °C increments"):
        await wizard.heat(202)

    await wizard.heat(205)
    assert printer.data.target == 205


@pytest.mark.asyncio
async def test_invalid_state_transition_is_rejected():
    printer = MockPrinter()
    wizard = ExtruderWizard(printer)
    await wizard.start(120, 100)

    with pytest.raises(WizardError, match="not allowed"):
        await wizard.extrude()


@pytest.mark.asyncio
async def test_disconnect_moves_session_to_error():
    wizard, printer = await heated_wizard()
    printer.simulate(connected=False)

    with pytest.raises(WizardError, match="connection lost"):
        await wizard.extrude()
    assert wizard.session.state == WizardState.ERROR


@pytest.mark.asyncio
async def test_implausible_result_cannot_be_applied():
    wizard, _ = await heated_wizard()
    await wizard.extrude()
    await wizard.measurement(50)

    with pytest.raises(WizardError, match="Plausibility"):
        await wizard.apply()
