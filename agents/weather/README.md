# Weather Agent

The Weather Agent runs the Apache-2.0 `weather-forecast-server` MCP package
inside its AgentCore runtime over STDIO. The server calls wttr.in first and
Open-Meteo as a fallback; no API key is required. The package can provide a
forecast for up to three days and does not accept a target date or guarantee
rain probability, so the agent must report those fields as unavailable when
the MCP result does not provide them.
Temperatures are presented consistently in Celsius; Fahrenheit-only values are
converted before being shown.
When the MCP returns multiple forecast days, the agent reports each returned day
separately and omits dates or values that are not present in the tool response.

Attribution: [shibing624/weather-forecast-server](https://github.com/shibing624/weather-forecast-server),
Apache License 2.0.
