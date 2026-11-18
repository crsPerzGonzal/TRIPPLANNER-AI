import re
import sys

from bedrock_agentcore.runtime import serve_a2a
from mcp import StdioServerParameters, stdio_client
from strands import Agent
from strands.multiagent.a2a.executor import StrandsA2AExecutor
from strands.tools.mcp import MCPClient
from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

from model.load import load_model

weather_mcp = MCPClient(
    lambda: stdio_client(
        StdioServerParameters(
            command=sys.executable,
            args=["-m", "weather_forecast_server"],
        )
    ),
    startup_timeout=30,
)
weather_mcp.start()

mcp_tools = weather_mcp.list_tools_sync()
weather_tool = next(
    (tool for tool in mcp_tools if tool.tool_name == "get_weather"),
    None,
)
if weather_tool is None:
    weather_mcp.stop(None, None, None)
    raise RuntimeError("El servidor MCP de clima no expone get_weather.")

agent_tools = [
    MCPAgentTool(
        mcp_tool=tool.mcp_tool,
        mcp_client=weather_mcp,
        name_override=re.sub(r"[^a-zA-Z0-9_-]", "_", tool.tool_name),
    )
    for tool in mcp_tools
]

SYSTEM_PROMPT = """
Eres un agente especializado en pronosticos del clima. Usa get_weather con el nombre
de la ciudad que indique el usuario; no omitas la ciudad ni uses la ubicacion de la IP
del servidor. El servidor obtiene datos de wttr.in y puede usar Open-Meteo como respaldo.
El pronostico disponible es de hasta tres dias y get_weather no acepta una fecha. Si la
fecha solicitada no aparece en los datos devueltos, explica que no hay pronostico
disponible para esa fecha. Cuando la herramienta devuelva varios dias, presenta cada dia
por separado y conserva solo la informacion meteorologica de ese dia.
Presenta todas las temperaturas en grados Celsius (°C), sin mostrar valores en Fahrenheit.
Si la herramienta solo devuelve °F, convierte con (°F - 32) * 5 / 9 y redondea al grado
mas cercano; si devuelve °C, conserva ese valor. Incluye probabilidad de lluvia unicamente
si la herramienta la proporciona; de lo contrario, indica que no esta disponible. Nunca
presentes datos simulados como observaciones reales.

Formato obligatorio para resultados diarios:
## Clima en [ciudad]

### Día 1 — [día y fecha tal como aparecen en la herramienta]
- **Temperatura máxima:** ...
- **Temperatura mínima:** ...
- **Condiciones:** ...
- **Probabilidad de lluvia:** ... (solo si la herramienta la proporciona)

Repite el bloque solo para cada día que aparezca en el resultado de get_weather, hasta
un máximo de tres. No inventes fechas, máximas, mínimas ni condiciones. Si la respuesta
solo contiene clima actual o no se puede separar por días, dilo y devuelve el resumen
disponible sin crear bloques diarios artificiales.
"""

agent = Agent(
    model=load_model(),
    system_prompt=SYSTEM_PROMPT,
    tools=agent_tools,
)


if __name__ == "__main__":
    serve_a2a(StrandsA2AExecutor(agent))
