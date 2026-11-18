import os
import re

from bedrock_agentcore.runtime import serve_a2a
from strands import Agent
from strands.multiagent.a2a.executor import StrandsA2AExecutor
from strands.tools.mcp import MCPClient
from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

from alice_auth import AliceOAuthAuth
from model.load import load_model

ALICE_MCP_URL = "https://mcp.alice.co.il/mcp"
OAUTH_SECRET_ID = os.environ.get("ALICE_OAUTH_SECRET_ID")
if not OAUTH_SECRET_ID:
    raise RuntimeError("ALICE_OAUTH_SECRET_ID debe identificar el secreto OAuth de Alice.")

travel_mcp = MCPClient(
    url=ALICE_MCP_URL,
    auth_provider=AliceOAuthAuth(OAUTH_SECRET_ID),
    startup_timeout=30,
)
travel_mcp.start()

mcp_tools = travel_mcp.list_tools_sync()
direct_search_tool = next(
    (tool for tool in mcp_tools if tool.tool_name == "search_flights"),
    None,
)
if direct_search_tool is None:
    travel_mcp.stop(None, None, None)
    raise RuntimeError("El servidor MCP de Alice no expone search_flights.")

agent_tools = [
    MCPAgentTool(
        mcp_tool=tool.mcp_tool,
        mcp_client=travel_mcp,
        name_override=re.sub(r"[^a-zA-Z0-9_-]", "_", tool.tool_name),
    )
    for tool in mcp_tools
]

SYSTEM_PROMPT = """
Eres un agente especializado en busqueda de vuelos con datos reales de Alice Flights.
Usa search_flights solo cuando el usuario necesite opciones de vuelo y ya se conozcan
origen, destino y fecha de salida. `origin` siempre es el aeropuerto de salida y
`destination` el aeropuerto de llegada; conserva el orden indicado por el usuario.
Por ejemplo, "Barranquilla a Bogota" significa origin=BAQ y destination=BOG, nunca
al reves. Convierte ambos lugares a codigos IATA de tres letras. Si un lugar tiene
varios codigos posibles, pide aclaracion antes de buscar.
Usa la fecha YYYY-MM-DD. Si no se indican pasajeros, busca un adulto; cuando se indique
el total de viajeros, usa el numero correspondiente de adultos, salvo que se indiquen
edades o categorias distintas. Puedes incluir fecha de regreso si el usuario la dio.
No inventes vuelos, precios, disponibilidad ni datos que la herramienta no devuelva.
Verifica que los vuelos devueltos salgan del origen solicitado y lleguen al destino
solicitado. Si el MCP devuelve la direccion contraria, no presentes esos vuelos como
opciones validas para la solicitud.
Presenta como maximo tres itinerarios del resultado de la herramienta. Cada elemento
de `flights` es una opcion independiente: nunca combines dos elementos en una opcion,
aunque compartan precio, aerolinea o duracion. Si un elemento tiene varias categorias
como best, cheapest o fastest, sigue siendo una sola opcion. Para cada opcion, toma
vuelos, horarios, duracion, precio, escalas y asientos del mismo elemento. No incluyas
enlaces salvo que el usuario los solicite.
"""

agent = Agent(
    model=load_model(),
    system_prompt=SYSTEM_PROMPT,
    tools=agent_tools,
)


if __name__ == "__main__":
    serve_a2a(StrandsA2AExecutor(agent))
