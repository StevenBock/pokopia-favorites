# PokéOpia — Pokémon Pokopia favorites lookup

A tiny static webapp to plan shared Pokémon housing in **Pokémon Pokopia**, based on
each Pokémon's ideal habitat and five favorites.

- **Lookup** — pick a Pokémon, see every item matching its favorites, grouped by category.
- **Sharing Groups** — Pokémon that can live together: identical habitat **and** identical
  five favorites (food flavor excluded).
- **Custom Group** — pick up to 4 Pokémon, see a habitat-compatibility check, every item that
  covers multiple of them, and a suggested minimal item set covering all their favorites.

## Run

```
python3 -m http.server   # then open http://localhost:8000
```
(`data.json` is loaded via fetch, so it needs to be served over http, not opened as a file.)

## Refresh the data

```
node scrape.mjs          # re-scrapes Serebii into data.json
```

## Attribution

All Pokémon/item data and images are sourced from
[Serebii.net](https://www.serebii.net/pokemonpokopia/). Images are mirrored into
`assets/` (re-run `node scrape.mjs` to refresh them). Pokémon and Pokémon Pokopia are
© Nintendo / Game Freak / The Pokémon Company. This is a non-commercial fan tool.
