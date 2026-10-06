# WARP and Tailscale for the Windows host

This guide covers a Windows host that uses **personal Cloudflare WARP** for internet connectivity and Tailscale for the iPhone connection. Keep WARP enabled if the connection depends on it. Diagnose the actual host; VPN behavior can differ between Windows and macOS.

## Intended division of responsibilities

- WARP continues handling ordinary internet traffic.
- Tailscale provides the private phone-to-host path. The host does not need to use a Tailscale exit node for GlasHaus.
- If a DNS conflict is demonstrated, give one VPN responsibility for system DNS. Do not change a working DNS setup speculatively. The phone can keep Tailscale's DNS for its private host name even if Tailscale DNS is disabled on the computer.
- Tailscale Serve forwards HTTPS to the loopback phone API on port 7778. The administration page on port 7777 stays local. Pairing and token authentication remain required.

Cloudflare describes routing and DNS separation in its [VPN coexistence guidance](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/vpn/). That page describes Cloudflare One organization profiles; do not assume its dashboard steps apply to personal WARP. The installed personal client's capabilities must be checked first.

Tailscale documents private ranges `100.64.0.0/10` and `fd7a:115c:a1e0::/48`, and warns that using an exit node conflicts with the split-tunnel workaround. See [Tailscale with other VPNs](https://tailscale.com/docs/reference/faq/other-vpns).

## Read-only check first

Run the contents of `Check-GlasHaus-Connection.ps1` in PowerShell with both clients enabled. It reports versions, status, selected Tailscale preferences, WARP exclusions and DNS lookup success. It makes no configuration changes. It does not print authentication tokens, full Tailscale preferences, account details, or the peer inventory.

In a Windows acceptance check on 2026-10-05, Personal WARP 2026.7.1376.0 reported Connected/healthy. Tailscale 1.102.4 reported Running, online, no health warnings and no exit node. Tailscale DNS and accepted subnet routes are enabled. WARP already excludes the relevant private ranges, and both public and private DNS lookups passed. No Windows VPN configuration change is justified by this result. The tester subsequently confirmed authenticated iPhone chat with both clients enabled. Host restart and cellular reliability still need separate acceptance checks.

## Choose the change from the evidence

1. If either client is disconnected, establish why before changing routes. Do not assume that an installed client is online.
2. If both are online and only private name resolution fails, investigate DNS ownership. A possible host-only test is `tailscale set --accept-dns=false`, retaining the old setting for rollback. This leaves the computer using its existing DNS; it does not disable Tailscale authentication or the phone's DNS. See [client preferences](https://tailscale.com/docs/features/client/manage-preferences?tab=windows).
3. If private IP reachability fails, inspect WARP's existing exclusions and route selection. Preserve existing exclusions, and change only the missing private routes demonstrated by the check. Do not reset either client's settings or broadly bypass WARP for unrelated traffic.
4. If Tailscale cannot reach its coordination or relay services, inspect that exact connection failure. Do not assume that bypassing WARP helps: the ISP may require WARP for those destinations too.

No automatic repair script is included: the initial Windows coexistence check passed. Only make a targeted change if the end-to-end app test identifies a failure.

## Verify after a candidate fix

Keep WARP enabled throughout. Confirm both clients report online, ordinary internet access works, and the iPhone reaches the private HTTPS endpoint. A 401 response without a device token verifies reachability and authentication enforcement; it is not a failed pairing test. Then verify authenticated chat, reconnect after restarting the app and host, and access over cellular. Check `tailscale serve status` before adding a service, so an existing listener is not replaced.

On a host that deliberately does not use Tailscale DNS, a private-hostname lookup from that host is not itself an acceptance requirement. Test the iPhone's lookup and connection separately. Do not replace the hostname with a bare IP in the app: TLS hostname verification must stay enabled.

## Mac experiment, 2026-10-05

With WARP enabled, ordinary IPv4 and IPv6 HTTPS requests to Tailscale's coordination host succeeded. The native Tailscale client still reported no route to that service. Disabling Tailscale DNS and adding a temporary WARP exclusion for only the coordination hostname did not restore online status. Both changes were reverted. This result is specific to the tested Mac setup and does not indicate a Windows failure.
