# Review before applying on RouterOS RB5009
/user group add name=monitor-readonly policy=read,api,!local,!telnet,!ssh,!ftp,!reboot,!write,!policy,!test,!winbox,!password,!web,!sniff,!sensitive,!romon
/user add name=monitor group=monitor-readonly
/user set monitor disabled=no
# Set the password manually on the router after reviewing this script.

