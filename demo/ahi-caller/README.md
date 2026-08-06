# ahi-caller

Agent-to-agent invocation over HTTP with
[`@rcrsr/rill-agent-ext-ahi`](../../packages/agent/ahi). This agent takes a
`text` param and relays it to the **http-echo** agent (running separately) by
calling `$ahi.echo(...)`, then returns what http-echo sends back. It is served
over the HTTP harness; the AHI extension turns a mounted agent name into an
HTTP `POST /run` against that agent's URL.

## Layout

```
main.rill           # rill source — hoists the ahi extension and calls $ahi.echo
rill-config.json    # mounts `ahi` -> @rcrsr/rill-agent-ext-ahi, config.ahi.agents.echo.url
rill-bundle.json    # rill 0.20 bundle config — declares the HTTP harness, port 3003
package.json        # workspace package (depends on core, http, and ahi)
```

## The extension idiom

A mounted extension is **hoisted** with `use<ext:<mount>> => $name`, then called
by member access. This is the load-bearing line — calling the mount name
directly (`ahi.echo(...)` or `ahi::echo(...)`) without the hoist raises
`RILL_R006 Unknown function`:

```rill
|text: string| {
  use<ext:ahi> => $ahi
  $ahi.echo([input: $text]) => $reply
  $reply
}:string => $caller
```

`ahi` is the mount name from `rill-config.json`; `echo` is the agent name under
`extensions.config.ahi.agents`. The call sends `POST /run` to that agent's URL
with `{ params, trigger, timeout }` and returns the downstream `result`.

## rill-config.json

```json
{
  "extensions": {
    "mounts": { "ahi": "@rcrsr/rill-agent-ext-ahi" },
    "config": {
      "ahi": {
        "agents": { "echo": { "url": "http://localhost:3001" } },
        "timeout": 10000
      }
    }
  }
}
```

URLs support `${VAR_NAME}` env-var substitution at init time.

## Run it (two servers)

The caller invokes `echo` over HTTP, so **http-echo must be running first**.

```bash
pnpm install

# Terminal 1 — the downstream agent on :3001
cd demo/http-echo && rill init && rill run

# Terminal 2 — the caller on :3003
cd demo/ahi-caller && rill init && rill run
```

Then, from a third shell:

```bash
curl -X POST http://localhost:3003/run \
  -H 'Content-Type: application/json' \
  -d '{"params":{"text":"via AHI"}}'
# {"state":"completed","result":"via AHI","streamed":false}
```

The caller received `text:"via AHI"`, relayed it to http-echo through
`$ahi.echo`, and returned http-echo's echo. Stop the downstream and the same
call returns a `#TRANSPORT` halt (`RILL-R031`, connection refused), which is the
AHI error mapping working.

## Notes

- **Static URL mode** is used here: the target agent's endpoint is fixed in
  `rill-config.json`. AHI also has an in-process mode
  (`createInProcessFunction`) for agents co-located in one harness process; it
  is not exercised by this demo.
- `@rcrsr/rill-agent-ext-ahi` resolves from this package's workspace
  `node_modules` while it is unpublished, so no `rill install` step is needed.
