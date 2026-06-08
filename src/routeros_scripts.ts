export function generateReadonlyMonitorScript(
  username: string,
  groupName: string,
): string {
  return [
    "# Review before applying on RouterOS RB5009",
    `/user group add name=${groupName} policy=read,api,!local,!telnet,!ssh,!ftp,!reboot,!write,!policy,!test,!winbox,!password,!web,!sniff,!sensitive,!romon`,
    `/user add name=${username} group=${groupName}`,
    `/user set ${username} disabled=no`,
    "# Set the password manually on the router after reviewing this script.",
  ].join("\n") + "\n";
}
