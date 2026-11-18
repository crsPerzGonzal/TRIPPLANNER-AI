# Flights Agent

The Flights Agent delegates flight searches to Alice Flights at
`https://mcp.alice.co.il/mcp` using Streamable HTTP and OAuth 2.0.

The OAuth client is authorized once with PKCE by running
`python agents\flight\authorize_alice.py`. The script stores the client and
refresh token in AWS Secrets Manager; it never prints token values. The
AgentCore runtime role needs `secretsmanager:GetSecretValue` and
`secretsmanager:PutSecretValue` for that secret so it can refresh a rotated
token. Do not put OAuth tokens in source files or runtime environment
variables.

Alice Flights is read-only, supports IATA origin/destination codes, and limits
the hosted endpoint to 10 searches per minute and 200 per day per IP.
`origin` is the departure airport and `destination` is the arrival airport;
the agent must preserve the direction requested by the user. Each flight offer
is a separate itinerary and must not be combined with another offer.
