import { ApiClient } from "../api/client.js";
import { startLogin } from "../auth/device.js";
import { TripdremoError } from "../errors.js";

export async function loginStart(args: { open_browser?: boolean } = {}, client: ApiClient) {
  if (args.open_browser !== undefined && typeof args.open_browser !== "boolean") {
    throw new TripdremoError("invalid_request", "open_browser must be boolean");
  }
  return startLogin(client, args.open_browser ?? true);
}
