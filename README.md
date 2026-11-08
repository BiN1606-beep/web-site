# web-site

A minimal OpenResty site with a static homepage and a Lua health endpoint.

## Run

Install OpenResty, then start the site from the project directory:

```sh
openresty -p "$PWD/" -c nginx.conf
```

Then open http://localhost:8080.
Stop OpenResty with `openresty -p "$PWD/" -c nginx.conf -s stop`.

## Test

With OpenResty running in another terminal:

```sh
sh tests/smoke.sh
```

Set `BASE_URL` to test a different address, for example `BASE_URL=http://localhost:9000 sh tests/smoke.sh`.
