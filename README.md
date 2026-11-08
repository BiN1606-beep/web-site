# web-site

A minimal OpenResty site serving a static homepage.

## Run

Install OpenResty, then start the site from the project directory:

```sh
sudo openresty -p "$PWD/" -c nginx.conf
```

If the default welcome site is already running on port 80, stop that OpenResty instance before starting this configuration.

Then open http://localhost. Stop OpenResty with `sudo openresty -p "$PWD/" -c nginx.conf -s stop`.

## Test

With OpenResty running in another terminal:

```sh
sh tests/smoke.sh
```

Set `BASE_URL` to test a different address, for example `BASE_URL=http://localhost:9000 sh tests/smoke.sh`.
