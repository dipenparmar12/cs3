# DEX → JVM translation spike

The Phase 1 spike that [docs/PRD/31](../../docs/PRD/31-cs3-dropin-compatibility.md)
required before any other drop-in work: *does translating Android DEX to JVM
bytecode preserve the Kotlin coroutine state machines every CloudStream provider
is built on?*

That question is RISK-D1, rated **Critical**, because every provider in the
ecosystem is coroutine-heavy — a translator bug there would be systemic rather
than long-tail, and would invalidate the whole approach.

**It is answered.** Results and their interpretation are in
[docs/PRD/35](../../docs/PRD/35-phase1-translation-spike-results.md).

## Running it

```bash
./fetch-corpus.sh                 # clones the builds branches, ~27 MB
mvn -q compile

# 1. Translate every plugin and verify the output
mvn -q exec:java -Dexec.mainClass=cs3.spike.TranslationSpike \
    -Dexec.args="corpus/cs3 corpus/refjar out"

# 2. Explain every divergence from publisher-built jars
mvn -q exec:java -Dexec.mainClass=cs3.spike.DiffDetail -Dexec.args="corpus/refjar out"

# 3. Measure the runtime classpath the sidecar must supply
mvn -q exec:java -Dexec.mainClass=cs3.spike.ClasspathSurvey -Dexec.args="out"
```

## What each tool establishes

| Tool | Question it answers |
|---|---|
| `TranslationSpike` | Does translation succeed, does the output verify, and do coroutine state machines survive? |
| `DiffDetail` | Where translated output differs from the publisher's own pre-dex jar, *why*? |
| `ClasspathSurvey` | Which types must be on the sidecar classpath for plugins to link? |

### On the reference jars

Three of the surveyed repositories publish a `.jar` next to each `.cs3` — the
publisher's own pre-dex build output. Diffing against those is the difference
between checking the translator against ground truth and checking it against
another estimate.

The comparison has one wrinkle worth knowing before reading its output: the
`.jar` is built **before** R8 runs and the `.cs3` is dexed **after**, so any
difference between them is a mix of translation effects and R8 effects.
`DiffDetail` separates the two, which is why its verdict is expressed as a
classification (`synthetic only`, `REAL METHOD LOST`) rather than a raw count.

### On `ClasspathSurvey` vs. doc 31 §2.3

Doc 31 estimated the Android surface by counting `android.*` **imports in
provider Kotlin source**. `ClasspathSurvey` counts **type references in the
shipped, translated bytecode**. The second number is much larger, and it is the
one that matters, because a `.cs3` also contains CloudStream library code that
R8 inlined into it — code that has to link even though it appears in no
provider's import list.
