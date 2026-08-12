#!/usr/bin/env bash
#
# Builds the .cs3 corpus the translation spike runs against.
#
# Clones the `builds` branch of every vendored community repository and collects
# the shipped .cs3 archives, plus any .jar the publisher happened to ship
# alongside them. Those jars matter: they are the publisher's own pre-dex
# output, which makes them ground truth for checking the translator rather than
# another estimate of it.
#
# Usage: ./fetch-corpus.sh [output-dir]   (default: ./corpus)

set -uo pipefail

OUT="${1:-corpus}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$OUT/cs3" "$OUT/refjar"

# Owners are taken from .gitmodules at the repository root. They are not all
# under the recloudstream organisation, and guessing that they are yields 404s.
REPOS=(
  recloudstream/extensions
  self-similarity/MegaRepo
  CranberrySoup/AniyomiCompatExtension
  Gian-Fr/ItalianProvider
  CakesTwix/cloudstream-extensions-uk
  techtanic/SkillShare-Repo
  SaurabhKaperwan/CSX
  phisher98/cloudstream-extensions-phisher
  Luna712/Luna712-CloudStream-Extensions
  redowan99/Redowan-CloudStream
  Abodabodd/re-3arabi
  doGior/doGiorsHadEnough
  DieGon7771/ItaliaInStreaming
  ycngmn/CuxPlug
  Bnyro/GermanProviders
  sarapcanagii/Pitipitii
  TeKuma25/IndoStream
  saimuelbr/saimuelrepo
  Kraptor123/cs-kraptor
  Kraptor123/cs-Karma
  redblacker8/storm-ext
  rockhero1234/cinephile
  med1245/cartoonyrepo
  Reflex755/ReflexRepo
)

total_cs3=0
total_jar=0

for repo in "${REPOS[@]}"; do
  name="${repo##*/}"
  dir="$WORK/$name"

  if ! git clone --depth 1 --branch builds --quiet "https://github.com/$repo.git" "$dir" 2>/dev/null; then
    echo "  skipped $repo (no builds branch, or unreachable)"
    continue
  fi

  n_cs3=0
  n_jar=0
  for f in "$dir"/*.cs3; do
    [ -e "$f" ] || continue
    # Non-ASCII plugin names exist in the wild; normalise so downstream tools
    # are not tripped by the filesystem encoding rather than by the bytecode.
    base="$(basename "$f" | tr -c 'A-Za-z0-9_.-' '_')"
    cp "$f" "$OUT/cs3/${name}__${base}"
    n_cs3=$((n_cs3 + 1))
  done
  for f in "$dir"/*.jar; do
    [ -e "$f" ] || continue
    base="$(basename "$f" | tr -c 'A-Za-z0-9_.-' '_')"
    cp "$f" "$OUT/refjar/${name}__${base}"
    n_jar=$((n_jar + 1))
  done

  echo "  $repo: $n_cs3 cs3, $n_jar reference jar(s)"
  total_cs3=$((total_cs3 + n_cs3))
  total_jar=$((total_jar + n_jar))
  rm -rf "$dir"
done

echo
echo "corpus ready in $OUT: $total_cs3 plugins, $total_jar reference jars"
