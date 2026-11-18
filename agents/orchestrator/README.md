# Orchestrator Agent

This source is the deployed Strands Orchestrator. It accepts a JSON `prompt`, streams the response through AgentCore, delegates flight and weather requests to the existing runtimes, and exposes business tools backed by the existing API Gateway.

The reference runtime has `COGNITO` on version 43 (JWT) and `DEFAULT` on version 44 (IAM SigV4), both `READY`. The system prompt restricts the Orchestrator to trip planning and management and politely redirects unrelated questions. See [docs/agentcore.md](../../docs/agentcore.md) for endpoint and deployment details.

The Cognito endpoint uses AgentCore's JWT authorizer. The runtime validates the access token before the handler derives the memory actor from its `sub` claim. A session ID is required for each conversation so AgentCore Memory stays scoped to the authenticated user and chat session.

Set `TRIPPLANNER_BUSINESS_API_URL` to the deployed API Gateway base URL, including its stage. The runtime must allow `X-TripPlanner-Business-Token` in addition to `Authorization`; API Gateway validates the ID token forwarded in that header for business operations.

The Orchestrator exposes `get_travel_preferences` and `save_travel_preferences` through the authenticated business API. It reads saved preferences when generating itineraries and writes changes only when the user explicitly requests them.

When the user explicitly asks the assistant to generate and save an itinerary, the Orchestrator lists the authenticated user's trips, resolves a unique matching trip, and uses its saved start/end dates to build one day per date. It checks the current itinerary first, then calls `create_itinerary` or `update_itinerary` with the API contract `{days: [{dayNumber, activities: [{name}]}]}`. If the trip is ambiguous or missing, it asks the user to clarify instead of writing to an arbitrary trip. The assistant confirms the save only after the write tool returns `ok: true`.
