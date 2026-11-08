## LINUX Ubuntu and Debian (x86-64 and ARM64)

Install with **apt**

Once, add the Lattice package source and its signing key:

```bash
wget https://lattice-md.app/apt/lattice-md-keyring.deb
sudo apt install ./lattice-md-keyring.deb
```

Then install Lattice:

```bash
sudo apt update
sudo apt install lattice-md
```

From then on, Lattice is updated with the rest of the system (`sudo apt upgrade` or the Software Updater).
`sudo apt install lattice` works as well; both names install the same package.

To remove Lattice, and the package source with it:

```bash
sudo apt remove lattice
sudo apt purge lattice-md-keyring
```
