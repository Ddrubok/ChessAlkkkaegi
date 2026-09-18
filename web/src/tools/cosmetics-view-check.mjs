import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// =========================================================================
// Headless DOM Environment Setup
// =========================================================================
class MockElement extends EventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.attributes = new Map();
    this._textContent = '';
    this.title = '';
    this.alt = '';
    this.src = '';
    this.disabled = false;
    this.type = 'button';
  }

  get textContent() {
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node instanceof MockElement) {
        if (node.parentElement) {
          node.parentElement.removeChild(node);
        }
        node.parentElement = this;
        this.children.push(node);
      }
    }
  }

  prepend(...nodes) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node instanceof MockElement) {
        if (node.parentElement) {
          node.parentElement.removeChild(node);
        }
        node.parentElement = this;
        this.children.unshift(node);
      }
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  removeChild(node) {
    const idx = this.children.indexOf(node);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      node.parentElement = null;
    }
    return node;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const match = (el) => {
      if (!el || !(el instanceof MockElement)) return false;
      const classes = el.className.split(/\s+/).filter(Boolean);
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (cls.includes('[')) {
          const [baseCls] = cls.split('[');
          return classes.includes(baseCls);
        }
        return classes.includes(cls);
      }
      if (selector.startsWith(':scope > .')) {
        const cls = selector.replace(':scope > .', '');
        return classes.includes(cls);
      }
      return false;
    };

    const traverse = (node, isDirectChild = false) => {
      for (const child of node.children) {
        if (selector.startsWith(':scope >')) {
          if (match(child)) results.push(child);
        } else {
          if (match(child)) results.push(child);
          traverse(child, false);
        }
      }
    };
    traverse(this, true);
    return results;
  }
}

globalThis.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.get(k) ?? null; },
  setItem(k, v) { this.store.set(k, String(v)); },
  removeItem(k) { this.store.delete(k); },
  clear() { this.store.clear(); }
};

globalThis.document = Object.assign(new EventTarget(), {
  documentElement: { lang: 'ko' },
  hidden: false,
  createElement(tag) {
    return new MockElement(tag);
  },
  body: new MockElement('body'),
});

globalThis.window = Object.assign(new EventTarget(), {
  location: { hostname: 'localhost', search: '' },
  localStorage: globalThis.localStorage,
  performance: globalThis.performance,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
});


const vite = await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
 const v=await vite.ssrLoadModule('/src/cosmetics-view.ts');
 const {I18nManager,SUPPORTED_LANGUAGES}=await vite.ssrLoadModule('/src/i18n.ts');
 const {createPlayerBanners}=await vite.ssrLoadModule('/src/player-banner.ts');
 const loadout={banner:'forest',frame:'frame:classic-gold',badge:'badge:mastery-m01',badgeFrame:'badgeFrame:silver',title:'title:challenger',titleFrame:'titleFrame:violet'};
 const card=document.createElement('section');const text=document.createElement('div');text.className='player-banner-text';card.append(text);
 const view=v.createCosmeticCardElements(card);v.updateCosmeticCard(view,loadout);
 for(let n=1;n<=8;n++) assert.equal(v.getCosmeticBadgeImage(`badge:mastery-m0${n}`, '/ChessAlkkagi/'), `/ChessAlkkagi/assets/cosmetics/badge-m0${n}.webp`);
 assert.equal(v.getCosmeticBadgeImage('unknown-m01-item'),null);
 const staleError=view.badgeImg.onerror;
 view.badgeImg.onerror();assert.equal(view.badgeImg.style.display,'none');
 v.updateCosmeticCard(view,{...loadout,badge:'badge:mastery-m02'});
 assert.equal(view.badgeImg.dataset.failed,undefined);
 staleError();assert.equal(view.badgeImg.dataset.failed,undefined);
 view.badgeImg.onload();assert.equal(view.badgeImg.style.display,'block');
 const unequippedError=view.badgeImg.onerror;
 v.updateCosmeticCard(view,{...loadout,badge:null});unequippedError();assert.equal(view.badgeLayer.hidden,true);
 v.updateCosmeticCard(view,loadout);
 assert.equal(card.dataset.theme,'forest');assert.equal(view.badgeFrameLayer.dataset.frame,'silver');assert.equal(view.titlePlate.dataset.frame,'violet');
 v.updateCosmeticCard(view,{...loadout,badge:null,title:null});assert.equal(view.badgeFrameLayer.hidden,true);assert.equal(view.titlePlate.hidden,true);
 v.updateCosmeticCard(view,{...loadout,titleFrame:null});assert.equal(view.titlePlate.dataset.frame,'none');
 for(const lang of SUPPORTED_LANGUAGES){I18nManager.setLanguage(lang.code);const title=v.getCosmeticTitleLabel('title:challenger');assert.ok(title.length);if(lang.code!=='ko')assert.ok(!/[?-?]/.test(title));}
 const state={visible:true,mode:'online',stage:1,currentSide:'white',mySide:'white',profile:{id:'me',nickname:'Self',classicMmr:1500},opponent:{id:'peer',nickname:'Peer',mmr:1500},rankedMode:'classic',loggedIn:false,opponentCosmetics:loadout};
 const parent=document.createElement('div');const controller=createPlayerBanners(parent,{getState:()=>state,requestFriend:async()=>({success:true})});controller.update();
 const opponent=controller.element.children[1];assert.equal(opponent.dataset.theme,'forest');assert.equal(opponent.dataset.hasFrame,'true');
 state.opponentCosmetics={...loadout,titleFrame:'titleFrame:gold'};controller.update();assert.equal(opponent.querySelector('.pb-title-plate').dataset.frame,'gold');
 state.mode='stage';controller.update();assert.equal(opponent.dataset.theme,'classic');assert.equal(opponent.dataset.hasFrame,'false');
 controller.destroy();assert.equal(parent.children.length,0);
 console.log('PASS cosmetics renderer: independent frames, hidden dependent slots, 9 languages, opponent updates and teardown');
} finally {await vite.close();}
