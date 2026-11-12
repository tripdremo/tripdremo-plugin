import { ApiClient } from "../api/client.js";
import { waitForLogin } from "../auth/device.js";
import { TripdremoError } from "../errors.js";

export async function loginWait(args: { timeout_seconds?: number } = {}, client: ApiClient) {
  if (args.timeout_seconds !== undefined) {
    if (!Number.isInteger(args.timeout_seconds) || args.timeout_seconds < 0 || args.timeout_seconds > 120) {
      throw new TripdremoError("invalid_request", "timeout_seconds must be an integer between 0 and 120");
    }
  }
  return waitForLogin(client, args.timeout_seconds ?? 120);
}
