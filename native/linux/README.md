# InkMark for Linux

This x86_64 build requires GTK 4.14+ and WebKitGTK 6. On Ubuntu 24.04:

```sh
sudo apt-get install libgtk-4-1 libwebkitgtk-6.0-4
```

On distributions without restricted user namespaces, launch `./InkMark` from
the extracted directory. Ubuntu's AppArmor policy restricts user namespaces by
default. Install at the path covered by the included application profile:

```sh
# Run from the directory containing the extracted InkMark directory.
sudo cp -a InkMark /opt/
sudo install -m 644 /opt/InkMark/inkmark.apparmor /etc/apparmor.d/inkmark
sudo apparmor_parser -r /etc/apparmor.d/inkmark
/opt/InkMark/InkMark
```

The profile grants user namespaces to this application path so WebKit can
create its sandbox. It does not disable WebKit sandboxing or the system-wide
AppArmor restriction. If you choose another installation path, update the
profile's executable path before loading it. The `/opt/InkMark` directory
should remain owned by the administrator who installed it.

Before removing the application, unload its profile:

```sh
sudo apparmor_parser -R /etc/apparmor.d/inkmark
sudo rm /etc/apparmor.d/inkmark
```

Workspace data stays in the application's WebKit profile; export a workspace
backup from InkMark before uninstalling or moving between computers.

Reference: [Ubuntu's application-specific user namespace policies](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces).
