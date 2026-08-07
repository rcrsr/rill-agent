# http-echo

A minimal rill agent exposed over [`@rcrsr/rill-agent-http`](../../packages/agent/http).
The agent echoes its `input` parameter straight back.

## Layout

```
main.rill           # rill source — a typed closure |input: string| -> string
rill-config.json    # rill project config (entry: main.rill:echo)
rill-bundle.json    # rill 0.20 bundle config — declares the HTTP harness
server.js           # manual host: loadManifest + createRouter + httpHarness
package.json        # workspace package
```

## Run as a rill 0.20 bundle (recommended)

`rill-bundle.json` declares `@rcrsr/rill-agent-http` as the bundle harness, so
`rill run` builds the package and serves it — no `server.js` needed. The
harness's `serve` hook assembles a router from the bundle's compiled packages
and listens on `config.port` (3001).

```bash
pnpm install       # links the workspace harness into this package's node_modules
rill init          # bootstraps .rill/ (gitignored); one-time per checkout
rill run           # builds, then serves on :3001
```

> The harness is resolved from this package's workspace `node_modules`, so no
> `rill install` step is needed while `@rcrsr/rill-agent-http` is unpublished.
> Once it is on npm, `rill install @rcrsr/rill-agent-http --replace` records it
> in `.rill/npm/` instead.

Then, from another shell:

```bash
curl http://localhost:3001/agents
# {"agents":[{"name":"http-echo","description":{...},"default":true}]}

curl -X POST http://localhost:3001/run \
  -H 'Content-Type: application/json' \
  -d '{"params":{"input":"hello"}}'
# {"state":"completed","result":"hello","streamed":false}

curl -X POST http://localhost:3001/agents/http-echo/run \
  -H 'Content-Type: application/json' \
  -d '{"params":{"input":"named"}}'
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List agents and their `describe()` output |
| `POST` | `/run` | Invoke the default agent |
| `POST` | `/agents/:name/run` | Invoke a named agent |

Request bodies match `RunRequest`: `{ params?, timeout? }`. Responses return
`RunResponse`: `{ state, result, streamed? }`.

## Run manually (library host)

```bash
pnpm --filter http-echo start   # node server.js, listens on PORT (default 3001)
```

`server.js` loads the compiled manifest from `build/http-echo/` and wraps it with
`httpHarness`. Produce `build/` with `rill run` (or `rill build`) once before
starting it manually. Override the port with `PORT`.
