from strands.models.bedrock import BedrockModel


def load_model() -> BedrockModel:
    """Carga el modelo Bedrock usando credenciales IAM."""
    return BedrockModel(model_id="us.amazon.nova-2-lite-v1:0")
