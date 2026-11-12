import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api/client.js";
import { VERSION } from "./version.js";
import { createTripdremoServer } from "./server.js";

const transport = new StdioServerTransport();
const client = new ApiClient(VERSION);
await createTripdremoServer(client).connect(transport);
