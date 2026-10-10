from __future__ import annotations

from typing import Any, Optional


class Message(str):
    """A diagnostic label with an explicit localization reference."""

    def __new__(cls, value: str, key: str, **params: Any):
        instance = super().__new__(cls, value)
        instance.message_key = key
        instance.message_params = params
        return instance


def normalize_message_params(values: dict[str, Any]) -> dict[str, Any]:
    result = {}
    for key, value in values.items():
        if isinstance(value, Message):
            result[key] = {
                "message_key": value.message_key,
                "message_params": normalize_message_params(value.message_params),
            }
        elif isinstance(value, dict):
            result[key] = normalize_message_params(value)
        elif value is None or isinstance(value, (str, int, float, bool)):
            result[key] = value
        else:
            result[key] = str(value)
    return result


class LocalizedErrorMixin:
    """Keep diagnostic text while exposing a stable UI key and named parameters."""

    def __init__(
        self,
        message: Any,
        *,
        message_key: Optional[str] = None,
        message_params: Optional[dict[str, Any]] = None,
    ) -> None:
        self.message_key = message_key or getattr(message, "message_key", None) or "errors.external"
        params = (
            message_params if message_params is not None else getattr(message, "message_params", {})
        )
        if self.message_key == "errors.external":
            params = {"detail": str(message)}
        self.message_params = normalize_message_params(params)
        super().__init__(str(message))
