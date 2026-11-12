import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api/client.js";
import { createTripdremoServer } from "./server.js";
const transport = new StdioServerTransport();
const client = new ApiClient("0.1.0");
await createTripdremoServer(client).connect(transport);
//# sourceMappingURL=index.js.map