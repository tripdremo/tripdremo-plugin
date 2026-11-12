import { deleteCredential, deletePendingRevocation, getToken, readPendingRevocation, writePendingRevocation, } from "../auth/store.js";
import { TripdremoError } from "../errors.js";
export async function logout(_args, client) {
    let remoteRevoked = true;
    const activeToken = getToken();
    const pendingToken = readPendingRevocation();
    const token = activeToken ?? pendingToken;
    try {
        if (activeToken) {
            await client.request("post", "/cli/auth/revoke/", {});
        }
        else if (pendingToken) {
            await client.requestWithToken("post", "/cli/auth/revoke/", {}, pendingToken);
        }
        deletePendingRevocation();
    }
    catch (error) {
        if (error instanceof TripdremoError && error.code === "not_authenticated") {
            deletePendingRevocation();
        }
        else {
            remoteRevoked = false;
            if (token)
                writePendingRevocation(token);
        }
    }
    finally {
        deleteCredential();
    }
    return { ok: true, remote_revoked: remoteRevoked };
}
//# sourceMappingURL=logout.js.map