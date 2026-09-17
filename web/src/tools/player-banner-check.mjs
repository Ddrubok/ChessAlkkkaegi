import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const vite = await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false},plugins:[{
 name:'banner-network-mock',load(id){if(id.includes('supabase-client'))return 'export function getSupabaseClient(){return globalThis.__bannerClient;}';}
}]});
try {
 const {getPlayerBannerModels}=await vite.ssrLoadModule('/src/player-banner.ts');
 const theme=await vite.ssrLoadModule('/src/banner-theme.ts');
 const {I18nManager,SUPPORTED_LANGUAGES}=await vite.ssrLoadModule('/src/i18n.ts');
 const profile={id:'me',nickname:'Tester',classicMmr:1500,strategyMmr:2300};
 const state={visible:true,mode:'online',stage:4,currentSide:'black',mySide:'black',profile,opponent:{id:'other',nickname:'name_%',mmr:1800},rankedMode:'classic',loggedIn:true};
 let models=getPlayerBannerModels(state);
 assert.equal(models.self.side,'black');assert.equal(models.opponent.side,'white');assert.equal(models.canAddFriend,true);
 const classic=models.self.detail;
 models=getPlayerBannerModels({...state,rankedMode:'strategy'});assert.notEqual(models.self.detail,classic);
 models=getPlayerBannerModels({...state,mode:'stage'});assert.equal(models.opponent.name,'AI');assert.ok(models.opponent.detail.includes('4'));assert.equal(models.canAddFriend,false);
 assert.equal(getPlayerBannerModels({...state,loggedIn:false}).canAddFriend,false);
 assert.equal(getPlayerBannerModels({...state,opponent:null}).canAddFriend,false);
 assert.equal(getPlayerBannerModels({...state,opponent:{...state.opponent,id:'me'}}).canAddFriend,false);
 assert.equal(getPlayerBannerModels({...state,mode:'hotseat'}).canAddFriend,false);
 assert.equal(getPlayerBannerModels({...state,mode:'hotseat'}).opponent.detail,I18nManager.t('lobby.mode_2p_short'));
 let changes=0;const unsubscribe=theme.subscribeBannerTheme(()=>changes++);
 theme.setBannerTheme('forest');assert.equal(theme.getBannerTheme(),'forest');assert.equal(localStorage.getItem('chessAlkkagi.bannerTheme'),'forest');
 theme.setBannerTheme('forest');assert.equal(changes,1);theme.setBannerTheme('invalid');assert.equal(theme.getBannerTheme(),'forest');unsubscribe();
 for(const {code} of SUPPORTED_LANGUAGES){I18nManager.setLanguage(code);for(const name of theme.BANNER_THEMES){assert.ok(theme.bannerThemeLabel(name));if(code!=='ko')assert.ok(!/[가-힣]/.test(theme.bannerThemeLabel(name)));}assert.ok(theme.bannerSettingsText('tab'));assert.ok(theme.bannerSettingsText('hint'));}
 const {SocialService}=await vite.ssrLoadModule('/src/social-service.ts');
 let target='other',existing=null;const filters=[],writes=[];
 globalThis.__bannerClient={from(table){const query={select(){return query},eq(key,value){filters.push([key,value]);return query},ilike(){throw new Error('Banner must target the known user ID, not a nickname pattern');},or(){return query},single:async()=>({data:{id:target,nickname:'name_%'}}),maybeSingle:async()=>({data:existing}),insert:async value=>{writes.push(value);return {error:null}}};return query;}};
 assert.equal((await SocialService.sendFriendRequest('me','name_%','other')).success,true);
 assert.deepEqual(filters,[['id','other']]);assert.equal(writes[0].addressee_id,'other');
 existing={id:'friendship',status:'pending'};assert.equal((await SocialService.sendFriendRequest('me','name_%','other')).error,'request_already_sent');assert.equal(writes.length,1);
 target='me';assert.equal((await SocialService.sendFriendRequest('me','name_%','me')).error,'cannot_add_self');assert.equal(writes.length,1);
 console.log('PASS banner: sides, mode ratings, bot/guest/manual restrictions, theme persistence, 9 languages and exact friend target');
}finally{delete globalThis.__bannerClient;await vite.close();}
