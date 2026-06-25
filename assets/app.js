(() => {
  const { createApp } = Vue;

  const HAB_COLOR = {
    Bright: '#caa53d',
    Warm: '#c0673a',
    Cool: '#3a78c0',
    Dark: '#5b5170',
    Cold: '#5aa6c0',
    Hot: '#c0473a',
    Wet: '#3a8fc0',
    Dry: '#b08a4a',
    Lush: '#4aa84a'
  };
  const TABS = [
    { id: 'lookup', label: 'Lookup' },
    { id: 'sharing', label: 'Sharing Groups' },
    { id: 'custom', label: 'Custom Group' },
    { id: 'items', label: 'Items' },
    { id: 'collection', label: 'Collection' },
    { id: 'planner', label: 'Island Planner' },
    { id: 'finder', label: 'Finder' }
  ];
  const GROUPS_KEY = 'pokopia.customGroups';
  const OWN_KEY = 'pokopia.owned.v2';

  function readStoredJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  function loadStoredGroups() {
    return readStoredJson(GROUPS_KEY, []);
  }

  function loadStoredOwned() {
    return new Set(readStoredJson(OWN_KEY, []));
  }

  const ItemCard = {
    props: {
      item: { type: Object, required: true }
    },
    template: `
      <div class="card">
        <img :src="item.icon" alt="" loading="lazy">
        <span class="nm">{{ item.name }}</span>
      </div>
    `
  };

  const PokemonCard = {
    props: {
      pokemon: { type: Object, required: true },
      shared: { type: Array, default: () => [] },
      owned: { type: Boolean, default: false },
      title: { type: String, default: '' }
    },
    emits: ['open'],
    methods: {
      pad(id) {
        return String(id).padStart(3, '0');
      }
    },
    template: `
      <div class="pmon" :class="{ own: owned }" :title="title || ('Open ' + pokemon.name + ' in Lookup')" style="cursor:pointer" @click="$emit('open', pokemon)">
        <img :src="pokemon.icon" alt="" loading="lazy">
        <span class="nm">{{ pokemon.name }}</span>
        <span class="muted">#{{ pad(pokemon.id) }}</span>
        <span v-if="pokemon.flavor" class="muted">{{ pokemon.flavor }} flavors</span>
        <span v-if="shared.length" class="covnames" style="text-align:center">{{ shared.join(', ') }}</span>
      </div>
    `
  };

  createApp({
    components: { ItemCard, PokemonCard },
    data() {
      return {
        tabs: TABS,
        activeTab: 'lookup',
        data: { pokemon: [], items: [], habitats: {} },
        byCat: {},
        loading: true,
        dataError: false,
        lookupSlug: null,
        globalSearch: '',
        sharingFilter: '',
        slots: [null, null, null, null, null],
        slotQueries: ['', '', '', '', ''],
        savedGroups: [],
        owned: loadStoredOwned(),
        colSearch: '',
        colHab: '',
        itemSearch: '',
        itemSuggestionOpen: false,
        curItem: null,
        itemsOwnedOnly: false,
        planner: {
          maxSize: 6,
          minShared: 2,
          ownedOnly: true
        },
        plannerResult: null,
        finderSets: {
          habitat: [],
          flavor: [],
          rarity: [],
          time: [],
          weather: [],
          location: []
        },
        finderName: '',
        finderFav: '',
        finderOwned: false,
        modalHabitatSlug: null,
        modalHabitat: null
      };
    },
    computed: {
      pokemon() {
        return this.data.pokemon || [];
      },
      items() {
        return this.data.items || [];
      },
      habitats() {
        return this.data.habitats || {};
      },
      currentPokemon() {
        return this.pokemon.find(p => p.slug === this.lookupSlug) || this.pokemon[0] || null;
      },
      lookupTotal() {
        if (!this.currentPokemon) return 0;
        return this.currentPokemon.favorites.reduce((n, cat) => n + this.itemsForCategory(cat).length, 0);
      },
      sharingGroups() {
        const map = new Map();
        for (const p of this.pokemon) {
          const key = p.habitat + '|' + [...p.favorites].sort().join(',');
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(p);
        }
        return [...map.values()].filter(g => g.length >= 2).sort((a, b) => b.length - a.length);
      },
      sharingQuery() {
        return (this.sharingFilter || '').toLowerCase().replace('#', '').trim();
      },
      sharingTarget() {
        return this.resolveMon(this.sharingQuery);
      },
      filteredSharingGroups() {
        const q = this.sharingQuery;
        if (!q) return this.sharingGroups;
        return this.sharingGroups.filter(group =>
          group.some(p => p.name.toLowerCase().includes(q)) ||
          group[0].favorites.some(cat => cat.toLowerCase().includes(q))
        );
      },
      sharingCountText() {
        if (this.sharingTarget) {
          return `Roommates for ${this.sharingTarget.name} — same habitat (${this.sharingTarget.habitat}), ranked by shared favorites`;
        }
        return `${this.filteredSharingGroups.length} groups with identical habitat & all 5 favorites` +
          (this.sharingQuery ? ' — type a full Pokémon name for partial roommate matches' : '');
      },
      compatTiers() {
        if (!this.sharingTarget) return [];
        const target = this.sharingTarget;
        const targetFavorites = new Set(target.favorites);
        const mates = this.pokemon
          .filter(p => p.slug !== target.slug && p.habitat === target.habitat)
          .map(p => ({ p, shared: p.favorites.filter(cat => targetFavorites.has(cat)) }))
          .filter(m => m.shared.length >= 1)
          .sort((a, b) => b.shared.length - a.shared.length || a.p.id - b.p.id);
        return [5, 4, 3, 2, 1]
          .map(n => ({ n, list: mates.filter(m => m.shared.length === n) }))
          .filter(tier => tier.list.length);
      },
      selectedCustom() {
        return this.slots.filter(Boolean);
      },
      customHabitats() {
        return [...new Set(this.selectedCustom.map(p => p.habitat))];
      },
      customMultiCategories() {
        const catCount = {};
        for (const p of this.selectedCustom) {
          for (const cat of p.favorites) {
            if (!catCount[cat]) catCount[cat] = [];
            catCount[cat].push(p);
          }
        }
        return Object.keys(catCount)
          .filter(cat => catCount[cat].length >= 2)
          .sort()
          .map(cat => ({
            cat,
            covered: catCount[cat],
            items: this.itemsForCategory(cat),
            all: catCount[cat].length === this.selectedCustom.length
          }));
      },
      customCoverCount() {
        return this.customMultiCategories.reduce((n, sec) => n + sec.items.length, 0);
      },
      customCover() {
        return this.coverItems(this.selectedCustom);
      },
      collectionHabitats() {
        return this.uniq(p => [p.habitat]);
      },
      filteredCollection() {
        const q = this.colSearch.toLowerCase().trim();
        return this.pokemon.filter(p =>
          (!q || p.name.toLowerCase().includes(q)) &&
          (!this.colHab || p.habitat === this.colHab)
        );
      },
      itemSuggestions() {
        const q = this.itemSearch.toLowerCase().trim();
        return q ? this.items.filter(item => item.name.toLowerCase().includes(q)).slice(0, 10) : [];
      },
      itemMatches() {
        if (!this.curItem) return [];
        return this.pokemon
          .map(p => ({ p, m: p.favorites.filter(cat => this.curItem.categories.includes(cat)) }))
          .filter(match => match.m.length && (!this.itemsOwnedOnly || this.owned.has(match.p.slug)))
          .sort((a, b) => b.m.length - a.m.length || a.p.id - b.p.id);
      },
      favoriteCategories() {
        return this.uniq(p => p.favorites);
      },
      finderFacets() {
        return [
          { key: 'habitat', label: 'Ideal habitat', values: this.uniq(p => [p.habitat]) },
          { key: 'rarity', label: 'Rarity', values: ['Common', 'Rare', 'Very Rare'] },
          { key: 'flavor', label: 'Flavor', values: this.uniq(p => [p.flavor]) },
          { key: 'location', label: 'Location', values: this.uniq(p => (p.find && p.find.locations) || []) },
          { key: 'time', label: 'Time', values: ['Morning', 'Day', 'Evening', 'Night'] },
          { key: 'weather', label: 'Weather', values: ['Sun', 'Cloud', 'Rain'] }
        ];
      },
      finderResults() {
        const usesFind = this.finderSets.rarity.length ||
          this.finderSets.time.length ||
          this.finderSets.weather.length ||
          this.finderSets.location.length;
        const name = this.finderName.toLowerCase();
        return this.pokemon.filter(p => {
          if (name && !p.name.toLowerCase().includes(name)) return false;
          if (this.finderFav && !p.favorites.includes(this.finderFav)) return false;
          if (this.finderOwned && !this.owned.has(p.slug)) return false;
          if (this.finderSets.habitat.length && !this.finderSets.habitat.includes(p.habitat)) return false;
          if (this.finderSets.flavor.length && !this.finderSets.flavor.includes(p.flavor)) return false;
          const find = p.find;
          if (usesFind && !find) return false;
          if (this.finderSets.rarity.length && !(find && this.finderSets.rarity.includes(find.rarity))) return false;
          if (this.finderSets.time.length && !(find && (find.time || []).some(t => this.finderSets.time.includes(t)))) return false;
          if (this.finderSets.weather.length && !(find && (find.weather || []).some(w => this.finderSets.weather.includes(w)))) return false;
          if (this.finderSets.location.length && !(find && (find.locations || []).some(l => this.finderSets.location.includes(l)))) return false;
          return true;
        }).sort((a, b) => a.id - b.id);
      }
    },
    async mounted() {
      window.addEventListener('hashchange', this.applyHash);
      document.addEventListener('keydown', this.handleKeydown);
      this.savedGroups = this.loadGroups();
      try {
        const response = await fetch('./data.json', { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.data = await response.json();
        this.buildCategoryIndex();
        this.applyHash();
      } catch {
        this.dataError = true;
      } finally {
        this.loading = false;
      }
    },
    beforeUnmount() {
      window.removeEventListener('hashchange', this.applyHash);
      document.removeEventListener('keydown', this.handleKeydown);
    },
    methods: {
      buildCategoryIndex() {
        const byCat = {};
        for (const item of this.items) {
          for (const cat of item.categories) {
            if (!byCat[cat]) byCat[cat] = [];
            byCat[cat].push(item);
          }
        }
        this.byCat = byCat;
      },
      pad(id) {
        return String(id).padStart(3, '0');
      },
      habStyle(habitat) {
        return { background: HAB_COLOR[habitat] || '#3a4663', color: '#fff' };
      },
      names(list) {
        return list.map(p => p.name).join(', ');
      },
      itemsForCategory(cat) {
        return this.byCat[cat] || [];
      },
      uniq(fn) {
        return [...new Set(this.pokemon.flatMap(p => fn(p) || []).filter(Boolean))].sort();
      },
      selectTab(tab) {
        if (tab === 'lookup') {
          const slug = this.lookupSlug || (this.pokemon[0] && this.pokemon[0].slug) || '';
          location.hash = slug ? `lookup/${slug}` : 'lookup';
        } else {
          location.hash = tab;
        }
      },
      applyHash() {
        const [tab, slug] = (location.hash || '#lookup').slice(1).split('/');
        const nextTab = TABS.some(t => t.id === tab) ? tab : 'lookup';
        this.activeTab = nextTab;
        if (nextTab === 'lookup') {
          const requested = slug && this.pokemon.find(p => p.slug === slug);
          const current = this.lookupSlug && this.pokemon.find(p => p.slug === this.lookupSlug);
          const fallback = this.pokemon[0] || null;
          this.lookupSlug = (requested || current || fallback || {}).slug || null;
        }
      },
      goToLookup(slug) {
        this.lookupSlug = slug;
        this.activeTab = 'lookup';
        location.hash = `lookup/${slug}`;
        this.scrollToTop();
      },
      scrollToTop() {
        this.$nextTick(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
      },
      handleGlobalSearch() {
        const q = this.globalSearch.toLowerCase().replace('#', '').trim();
        if (!q) return;
        const match = this.pokemon.find(p =>
          p.name.toLowerCase().includes(q) ||
          String(p.id).padStart(3, '0') === q.padStart(3, '0')
        );
        if (match) this.goToLookup(match.slug);
      },
      resolveMon(q) {
        if (!q) return null;
        if (/^\d+$/.test(q)) return this.pokemon.find(p => p.id === Number(q)) || null;
        const exact = this.pokemon.find(p => p.name.toLowerCase() === q);
        if (exact) return exact;
        const prefixMatches = this.pokemon.filter(p => p.name.toLowerCase().startsWith(q));
        return prefixMatches.length === 1 ? prefixMatches[0] : null;
      },
      groupKey(group) {
        return group.map(p => p.slug).join('|');
      },
      loadGroups() {
        return loadStoredGroups();
      },
      saveGroups(groups) {
        try {
          localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
          this.savedGroups = groups;
        } catch {
          alert('Could not save (storage blocked).');
        }
      },
      saveCurrentGroup() {
        const selected = this.selectedCustom;
        if (!selected.length) {
          alert('Pick at least one Pokémon first.');
          return;
        }
        const defaultName = selected.map(p => p.name).join(', ').slice(0, 40);
        const name = (prompt('Name this group:', defaultName) || '').trim();
        if (!name) return;
        const groups = this.savedGroups.filter(group => group.name !== name);
        groups.push({ name, ids: selected.map(p => p.slug) });
        this.saveGroups(groups);
      },
      applyGroup(group) {
        const slots = [null, null, null, null, null];
        group.ids.slice(0, 5).forEach((slug, index) => {
          slots[index] = this.pokemon.find(p => p.slug === slug) || null;
        });
        this.slots = slots;
        this.slotQueries = ['', '', '', '', ''];
      },
      deleteGroup(index) {
        const groups = this.savedGroups.slice();
        groups.splice(index, 1);
        this.saveGroups(groups);
      },
      slotHits(index) {
        const q = this.slotQueries[index].toLowerCase().trim();
        return q ? this.pokemon.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8) : [];
      },
      selectSlot(index, pokemon) {
        this.slots.splice(index, 1, pokemon);
        this.slotQueries.splice(index, 1, '');
      },
      clearSlot(index) {
        this.slots.splice(index, 1, null);
      },
      coverItems(selected) {
        const need = new Set();
        for (const p of selected) {
          for (const cat of p.favorites) need.add(cat);
        }
        const pick = [];
        while (need.size) {
          let best = null;
          let gain = 0;
          for (const item of this.items) {
            const itemGain = item.categories.filter(cat => need.has(cat)).length;
            if (itemGain > gain) {
              gain = itemGain;
              best = item;
            }
          }
          if (!best) break;
          best.categories.filter(cat => need.has(cat)).forEach(cat => need.delete(cat));
          pick.push(best);
        }
        return { pick, left: [...need] };
      },
      saveOwned() {
        try {
          localStorage.setItem(OWN_KEY, JSON.stringify([...this.owned]));
        } catch {}
      },
      toggleOwned(slug) {
        if (this.owned.has(slug)) this.owned.delete(slug);
        else this.owned.add(slug);
        this.saveOwned();
      },
      markFilteredOwned() {
        this.filteredCollection.forEach(p => this.owned.add(p.slug));
        this.saveOwned();
      },
      unmarkFiltered() {
        this.filteredCollection.forEach(p => this.owned.delete(p.slug));
        this.saveOwned();
      },
      clearOwned() {
        if (!confirm('Clear your whole collection?')) return;
        this.owned.clear();
        this.saveOwned();
      },
      selectItem(item) {
        this.curItem = item;
        this.itemSearch = item.name;
        this.itemSuggestionOpen = false;
      },
      runPlanner() {
        const maxSize = Math.max(2, Number(this.planner.maxSize) || 6);
        const minShared = Math.max(0, Number(this.planner.minShared) || 0);
        const pool = this.pokemon.filter(p => !this.planner.ownedOnly || this.owned.has(p.slug));
        if (!pool.length) {
          this.plannerResult = {
            bad: true,
            message: `No ${this.planner.ownedOnly ? 'owned ' : ''}Pokémon to plan. Mark some in the Collection tab${this.planner.ownedOnly ? ', or uncheck “Owned only”' : ''}.`
          };
          return;
        }
        const byHabitat = {};
        for (const p of pool) {
          if (!byHabitat[p.habitat]) byHabitat[p.habitat] = [];
          byHabitat[p.habitat].push(p);
        }
        const rooms = [];
        for (const hab of Object.keys(byHabitat)) {
          const unassigned = byHabitat[hab].slice();
          while (unassigned.length) {
            const seed = unassigned.shift();
            const seedFavorites = new Set(seed.favorites);
            const room = [seed];
            while (room.length < maxSize) {
              let bestIndex = -1;
              let bestGain = -1;
              for (let index = 0; index < unassigned.length; index++) {
                const gain = unassigned[index].favorites.filter(cat => seedFavorites.has(cat)).length;
                if (gain > bestGain) {
                  bestGain = gain;
                  bestIndex = index;
                }
              }
              if (bestIndex < 0 || bestGain < minShared) break;
              room.push(unassigned.splice(bestIndex, 1)[0]);
            }
            rooms.push({ hab, members: room });
          }
        }
        rooms.sort((a, b) => b.members.length - a.members.length);
        const plannedRooms = rooms.map((room, index) => ({
          ...room,
          key: `${room.hab}-${index}-${room.members.map(p => p.slug).join('-')}`,
          cover: this.coverItems(room.members)
        }));
        this.plannerResult = {
          bad: false,
          poolCount: pool.length,
          rooms: plannedRooms,
          totalItems: plannedRooms.reduce((n, room) => n + room.cover.pick.length, 0)
        };
      },
      finderFacetOn(key, value) {
        return this.finderSets[key].includes(value);
      },
      toggleFinderFacet(key, value) {
        const list = this.finderSets[key];
        const index = list.indexOf(value);
        if (index >= 0) list.splice(index, 1);
        else list.push(value);
      },
      clearFinder() {
        this.finderSets = {
          habitat: [],
          flavor: [],
          rarity: [],
          time: [],
          weather: [],
          location: []
        };
        this.finderName = '';
        this.finderFav = '';
        this.finderOwned = false;
      },
      openHabitat(slug) {
        const habitat = this.habitats[slug];
        if (!habitat) return;
        this.modalHabitatSlug = slug;
        this.modalHabitat = habitat;
      },
      habitatUrl(slug) {
        return `https://www.serebii.net/pokemonpokopia/habitatdex/${slug}.shtml`;
      },
      closeModal() {
        this.modalHabitatSlug = null;
        this.modalHabitat = null;
      },
      handleKeydown(event) {
        if (event.key === 'Escape') this.closeModal();
      }
    }
  }).mount('#app');
})();
