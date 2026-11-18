import os

from strands.models.bedrock import BedrockModel


def load_model() -> BedrockModel:
    """Carga Nova Lite con el guardrail opcional configurado en AgentCore."""
    guardrail_id = os.environ.get("GUARDRAIL_ID")
    guardrail_version = os.environ.get("GUARDRAIL_VERSION")
    config = {"model_id": "us.amazon.nova-2-lite-v1:0"}
    if guardrail_id and guardrail_version:
        config.update(
            {
                "guardrail_id": guardrail_id,
                "guardrail_version": guardrail_version,
                "guardrail_trace": "enabled",
            }
        )
    return BedrockModel(**config)
