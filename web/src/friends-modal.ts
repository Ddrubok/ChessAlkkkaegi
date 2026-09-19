import { I18nManager } from "./i18n";
import {
  SocialService,
  type FriendProfile,
  type FriendRequestItem,
} from "./social-service";
import type { UserProfile } from "./supabase-auth";
import { escapeHtml } from "./html";
import { renderTierBadge } from "./tier-view";
import { progressStorage } from './progress-storage';
import { friendsCopy } from './friends-copy';
import './friends-modal.css';

let closeActiveFriends: (() => void) | undefined;

export interface FriendsModalCallbacks {
  onStartFriendlyMatch: (
    targetFriend: FriendProfile,
    roomId: string,
    isHost: boolean,
  ) => void;
}

/**
 * 친구 목록 및 관리 모달 렌더러
 */
export async function openFriendsModal(
  parentContainer: HTMLElement,
  userProfile: UserProfile | null,
  callbacks?: FriendsModalCallbacks,
): Promise<void> {
  closeActiveFriends?.();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = document.createElement("div");
  overlay.className = "friends-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.75);
    padding: 16px;
    box-sizing: border-box;
  `;

  const card = document.createElement("div");
  card.className = "friends-modal-card";
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', I18nManager.t('friends.title'));
  card.tabIndex = -1;
  card.style.cssText = `
    width: min(480px, 100%);
    max-height: 85vh;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    color: #f8fafc;
    font-family: inherit;
  `;

  let closed = false;
  let generation = 0;
  let activeChallengeRoom: string | null = null;
  let challengePending = false;
  let unsubscribePresence = () => {};
  let unsubscribeOwner = () => {};
  const background: Array<[HTMLElement, boolean]> = [];
  overlay.appendChild(card);
  parentContainer.appendChild(overlay);
  for (let node: HTMLElement = overlay; node.parentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && sibling instanceof HTMLElement) {
        background.push([sibling, sibling.inert]);
        sibling.inert = true;
      }
    }
  }
  const close = () => {
    if (closed) return;
    closed = true;
    generation++;
    if (activeChallengeRoom) {
      const roomId = activeChallengeRoom;
      activeChallengeRoom = null;
      SocialService.cancelChallenge(roomId);
    }
    unsubscribePresence();
    unsubscribeOwner();
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    background.forEach(([element, inert]) => { element.inert = inert; });
    if (closeActiveFriends === close) closeActiveFriends = undefined;
    if (opener?.isConnected) opener.focus();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(element => !element.hidden && !element.closest('[inert]'));
    const first = focusable[0] ?? card;
    const last = focusable[focusable.length - 1] ?? card;
    if (!overlay.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  };
  closeActiveFriends = close;
  document.addEventListener('keydown', onKeydown, true);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  const isMember = () => progressStorage.owner !== null && progressStorage.owner === userProfile?.id;
  unsubscribeOwner = progressStorage.subscribe(() => { if (!isMember()) close(); });

  if (!userProfile || !isMember()) {
    card.innerHTML = `
      <div style="padding:24px; text-align:center;">
        <h2 style="margin:0 0 12px; font-size:18px;">👥 ${I18nManager.t("friends.title")}</h2>
        <p style="color:#94a3b8; font-size:14px; margin-bottom:20px;">${I18nManager.t("friends.login_required")}</p>
        <button id="friends-login-close-btn" style="background:#2563eb; color:white; border:none; padding:10px 20px; border-radius:8px; font-weight:700; cursor:pointer;">
          ${I18nManager.t("common.close")}
        </button>
      </div>
    `;
    card.querySelector<HTMLButtonElement>("#friends-login-close-btn")?.addEventListener("click", close);
    card.querySelector<HTMLButtonElement>('button')?.focus();
    return;
  }

  let currentTab: "list" | "requests" | "add" = "list";
  let friendsList: FriendProfile[] = [];
  let pendingRequests: FriendRequestItem[] = [];
  let readState: 'loading' | 'success' | 'error' = 'loading';
  let listLoaded = false;
  let requestsLoaded = false;

  const renderContent = async (load = true) => {
    if (closed || !isMember()) { close(); return; }
    const activeId = card.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '';
    const requestGeneration = load ? ++generation : generation;
    const requestedTab = currentTab;
    if (load && currentTab !== 'add') {
      readState = 'loading';
      if (currentTab === 'list') listLoaded = false;
      else requestsLoaded = false;
    }

    card.innerHTML = `
      <!-- 헤더 -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid #1e293b;">
        <h2 style="margin:0; font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px;">
          <span>👥</span> ${I18nManager.t("friends.title")}
        </h2>
        <button id="friends-close-btn" aria-label="${escapeHtml(I18nManager.t('common.close'))}" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer; padding:4px 8px; line-height:1;">✕</button>
      </div>

      <!-- 탭 바 (친구 목록 / 받은 요청 / 친구 추가) -->
      <div style="display:flex; gap:6px; padding:10px 20px; background:#1e293b; border-bottom:1px solid #334155;">
        <button id="tab-friends-list" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:${currentTab === "list" ? "#2563eb" : "transparent"}; color:${currentTab === "list" ? "white" : "#94a3b8"};">
          ${I18nManager.t("friends.tab_list")} ${listLoaded ? `(${friendsList.length})` : ''}
        </button>
        <button id="tab-friends-requests" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:${currentTab === "requests" ? "#2563eb" : "transparent"}; color:${currentTab === "requests" ? "white" : "#94a3b8"};">
          ${I18nManager.t("friends.tab_requests")} ${requestsLoaded ? `(${pendingRequests.length})` : ""}
        </button>
        <button id="tab-friends-add" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:${currentTab === "add" ? "#2563eb" : "transparent"}; color:${currentTab === "add" ? "white" : "#94a3b8"};">
          ${I18nManager.t("friends.tab_add")}
        </button>
      </div>

      <!-- 탭 컨텐츠 바디 -->
      <div id="friends-tab-body" style="flex:1; overflow-y:auto; padding:16px 20px; min-height:260px; max-height:400px;"></div>
    `;

    card.querySelector("#friends-close-btn")?.addEventListener("click", close);

    card.querySelector("#tab-friends-list")?.addEventListener("click", () => {
      currentTab = "list";
      void renderContent();
    });
    card.querySelector("#tab-friends-requests")?.addEventListener("click", () => {
      currentTab = "requests";
      void renderContent();
    });
    card.querySelector("#tab-friends-add")?.addEventListener("click", () => {
      currentTab = "add";
      void renderContent();
    });

    const body = card.querySelector("#friends-tab-body") as HTMLElement;
    (activeId ? card.querySelector<HTMLElement>(`#${activeId}`) : null)?.focus();
    if (!card.contains(document.activeElement)) card.querySelector<HTMLElement>('#friends-close-btn')?.focus();

    if (currentTab !== 'add' && readState !== 'success') {
      body.innerHTML = `<p role="${readState === 'error' ? 'alert' : 'status'}">${escapeHtml(friendsCopy(readState === 'error' ? 'error' : 'loading'))}</p>${readState === 'error' ? `<button id="friends-retry-btn">${escapeHtml(friendsCopy('retry'))}</button>` : ''}`;
      body.setAttribute('aria-busy', String(readState === 'loading'));
      body.querySelector('#friends-retry-btn')?.addEventListener('click', () => void renderContent());
      if (load) {
        let result: FriendProfile[] | FriendRequestItem[] | null = null;
        try { result = requestedTab === 'list' ? await SocialService.getFriendsList(userProfile.id) : await SocialService.getPendingRequests(userProfile.id); } catch { /* Render the same recoverable error for thrown transports. */ }
        if (closed || requestGeneration !== generation || !isMember()) { if (!isMember()) close(); return; }
        readState = result === null ? 'error' : 'success';
        if (requestedTab === 'list') { friendsList = (result as FriendProfile[] | null) ?? []; listLoaded = result !== null; }
        else { pendingRequests = (result as FriendRequestItem[] | null) ?? []; requestsLoaded = result !== null; }
        await renderContent(false);
      }
      return;
    }

    // -------------------------------------------------------------
    // 탭 1: 친구 목록
    // -------------------------------------------------------------
    if (currentTab === "list") {
      if (friendsList.length === 0) {
        body.innerHTML = `
          <div style="padding:40px 20px; text-align:center; color:#64748b; font-size:13px;">
            ${I18nManager.t("friends.empty_friends")}
          </div>
        `;
      } else {
        body.innerHTML = `<div style="display:flex; flex-direction:column; gap:8px;"></div>`;
        const listWrapper = body.firstElementChild as HTMLElement;

        friendsList.forEach((friend) => {
          const row = document.createElement("div");
          row.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            font-size: 13px;
          `;

          let statusDot = "🟢";
          let statusText = I18nManager.t("friends.status_online");
          let statusColor = "#22c55e";
          let canChallenge = true;

          if (friend.status === "in_game") {
            statusDot = "🟠";
            statusText = I18nManager.t("friends.status_in_game");
            statusColor = "#f59e0b";
            canChallenge = false;
          } else if (friend.status === "in_queue") {
            statusDot = "🟡";
            statusText = I18nManager.t("friends.status_in_queue");
            statusColor = "#eab308";
            canChallenge = false;
          } else if (friend.status === "offline") {
            statusDot = "⚪";
            statusText = I18nManager.t("friends.status_offline");
            statusColor = "#64748b";
            canChallenge = false;
          }

          row.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:2px;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:10px;">${statusDot}</span>
                <strong style="color:#f8fafc; font-size:14px;">${escapeHtml(friend.nickname)}</strong>
                <span style="font-size:11px; color:${statusColor};">(${escapeHtml(statusText)})</span>
              </div>
              <div style="font-size:11px; color:#94a3b8; display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:2px;">
                <span style="display:inline-flex; align-items:center; gap:4px;">${I18nManager.t("online.classic_tab")}: ${renderTierBadge(friend.classicMmr, false)}</span>
                <span style="display:inline-flex; align-items:center; gap:4px;">${I18nManager.t("online.strategy_tab")}: ${renderTierBadge(friend.strategyMmr, false)}</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <button class="btn-challenge" style="background:${canChallenge ? "#2563eb" : "#334155"}; color:${canChallenge ? "white" : "#64748b"}; border:none; border-radius:6px; padding:6px 12px; font-size:12px; font-weight:700; cursor:${canChallenge ? "pointer" : "not-allowed"};" ${canChallenge ? "" : "disabled"}>
                ⚔️ ${I18nManager.t("friends.challenge_btn")}
              </button>
              <button class="btn-delete" style="background:transparent; border:none; color:#ef4444; font-size:12px; cursor:pointer; padding:6px 8px;">
                ${I18nManager.t("friends.delete_btn")}
              </button>
            </div>
          `;

          // 대전 신청 버튼
          row.querySelector(".btn-challenge")?.addEventListener("click", async () => {
            if (!canChallenge || closed || !isMember() || challengePending) return;
            challengePending = true;
            const challengeBtn = row.querySelector(".btn-challenge") as HTMLButtonElement;
            challengeBtn.disabled = true;
            challengeBtn.textContent = "...";
            const restoreChallengeFocus = () => {
              challengePending = false;
              card.inert = false;
              challengeBtn.disabled = false;
              challengeBtn.textContent = `⚔️ ${I18nManager.t('friends.challenge_btn')}`;
              if (!closed && isMember()) {
                (challengeBtn.isConnected ? challengeBtn : card.querySelector<HTMLElement>('#friends-close-btn') ?? card).focus();
              }
            };

            try {
              const { roomId, responsePromise } = await SocialService.sendChallenge(friend.id, "classic");
              if (closed || !isMember()) { SocialService.cancelChallenge(roomId); return; }
              activeChallengeRoom = roomId;
              
              // 15초 대기 팝업 렌더링
              const waitOverlay = document.createElement("div");
              waitOverlay.style.cssText = "position:fixed; inset:0; z-index:110; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.8);";
              waitOverlay.innerHTML = `
                <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:24px; text-align:center; max-width:320px;">
                  <h3 style="margin:0 0 8px; color:#f8fafc;">⚔️ ${escapeHtml(I18nManager.t("friends.challenge_sent", { name: friend.nickname }))}</h3>
                  <p style="color:#94a3b8; font-size:13px; margin:0 0 16px;">${I18nManager.t("friends.waiting_response", { time: 15 })}</p>
                  <button id="cancel-challenge-btn" style="background:#ef4444; color:white; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer;">${I18nManager.t("common.cancel")}</button>
                </div>
              `;
              overlay.appendChild(waitOverlay);
              card.inert = true;
              waitOverlay.querySelector<HTMLButtonElement>('button')?.focus();
              let cancelled = false;
              waitOverlay.querySelector("#cancel-challenge-btn")?.addEventListener("click", () => {
                cancelled = true;
                activeChallengeRoom = null;
                SocialService.cancelChallenge(roomId);
                waitOverlay.remove();
                restoreChallengeFocus();
              });

              const accepted = await responsePromise;
              if (activeChallengeRoom === roomId) activeChallengeRoom = null;
              waitOverlay.remove();
              restoreChallengeFocus();
              if (cancelled || !overlay.isConnected || !isMember()) {
                return;
              }

              if (accepted) {
                close();
                if (callbacks?.onStartFriendlyMatch) {
                  callbacks.onStartFriendlyMatch(friend, roomId, true);
                }
              } else {
                alert(I18nManager.t("friends.challenge_rejected"));
              }
            } catch (err) {
              restoreChallengeFocus();
              if (closed || !isMember()) return;
              alert(String(err));
            }
          });

          // 친구 삭제 버튼
          row.querySelector(".btn-delete")?.addEventListener("click", async () => {
            if (closed || !isMember()) return;
            if (friend.friendshipId && confirm(`${friend.nickname} - ${I18nManager.t("friends.delete_btn")}?`)) {
              await SocialService.deleteFriend(friend.friendshipId);
              void renderContent();
            }
          });

          listWrapper.appendChild(row);
        });
      }
    }

    // -------------------------------------------------------------
    // 탭 2: 받은 친구 요청
    // -------------------------------------------------------------
    else if (currentTab === "requests") {
      if (pendingRequests.length === 0) {
        body.innerHTML = `
          <div style="padding:40px 20px; text-align:center; color:#64748b; font-size:13px;">
            ${I18nManager.t("friends.empty_requests")}
          </div>
        `;
      } else {
        body.innerHTML = `<div style="display:flex; flex-direction:column; gap:8px;"></div>`;
        const reqWrapper = body.firstElementChild as HTMLElement;

        pendingRequests.forEach((req) => {
          const row = document.createElement("div");
          row.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            font-size: 13px;
          `;
          row.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:2px;">
              <strong style="color:#f8fafc; font-size:14px;">${escapeHtml(req.senderNickname)}</strong>
              <div style="font-size:11px; color:#94a3b8; display:inline-flex; align-items:center; gap:4px;">
                <span>${I18nManager.t("online.classic_tab")}:</span> ${renderTierBadge(req.senderClassicMmr, false)}
              </div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn-accept" style="background:#16a34a; color:white; border:none; border-radius:6px; padding:6px 12px; font-size:12px; font-weight:700; cursor:pointer;">
                ${I18nManager.t("friends.accept_btn")}
              </button>
              <button class="btn-reject" style="background:#dc2626; color:white; border:none; border-radius:6px; padding:6px 12px; font-size:12px; font-weight:700; cursor:pointer;">
                ${I18nManager.t("friends.reject_btn")}
              </button>
            </div>
          `;

          row.querySelector(".btn-accept")?.addEventListener("click", async () => {
            if (closed || !isMember()) return;
            await SocialService.respondFriendRequest(req.friendshipId, true);
            void renderContent();
          });

          row.querySelector(".btn-reject")?.addEventListener("click", async () => {
            if (closed || !isMember()) return;
            await SocialService.respondFriendRequest(req.friendshipId, false);
            void renderContent();
          });

          reqWrapper.appendChild(row);
        });
      }
    }

    // -------------------------------------------------------------
    // 탭 3: 닉네임으로 친구 추가
    // -------------------------------------------------------------
    else if (currentTab === "add") {
      body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:14px;">
          <div class="friends-search-form">
            <input type="text" id="friend-search-input" aria-label="${escapeHtml(I18nManager.t('friends.search_placeholder'))}" placeholder="${I18nManager.t("friends.search_placeholder")}" style="flex:1; background:#1e293b; border:1px solid #334155; border-radius:8px; padding:10px 14px; color:#f8fafc; font-size:14px; box-sizing:border-box;" />
            <button id="friend-search-btn" style="background:#2563eb; color:white; border:none; border-radius:8px; padding:10px 16px; font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap;">
              ${I18nManager.t("friends.search_btn")}
            </button>
          </div>
          <div id="friend-add-status" style="font-size:13px; min-height:20px; color:#38bdf8;"></div>
        </div>
      `;

      const searchInput = body.querySelector("#friend-search-input") as HTMLInputElement;
      const searchBtn = body.querySelector("#friend-search-btn") as HTMLButtonElement;
      const statusDiv = body.querySelector("#friend-add-status") as HTMLElement;

      const handleAdd = async () => {
        if (closed || !isMember() || searchBtn.disabled) return;
        const queryNick = searchInput.value.trim();
        if (!queryNick) return;

        searchBtn.disabled = true;
        statusDiv.style.color = "#94a3b8";
        statusDiv.textContent = "...";

        const res = await SocialService.sendFriendRequest(userProfile.id, queryNick);
        if (closed || !isMember() || requestGeneration !== generation) return;
        searchBtn.disabled = false;

        if (res.success) {
          statusDiv.style.color = "#22c55e";
          statusDiv.textContent = I18nManager.t("friends.request_sent_success", { name: queryNick });
          searchInput.value = "";
        } else {
          statusDiv.style.color = "#ef4444";
          if (res.error === "user_not_found") {
            statusDiv.textContent = I18nManager.t("friends.user_not_found");
          } else if (res.error === "cannot_add_self") {
            statusDiv.textContent = I18nManager.t("friends.cannot_add_self");
          } else if (res.error === "request_already_sent") {
            statusDiv.textContent = I18nManager.t("friends.request_already_sent");
          } else {
            statusDiv.textContent = res.error || "Error";
          }
        }
      };

      searchBtn.addEventListener("click", () => void handleAdd());
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void handleAdd();
      });
    }
  };

  // 실시간 Presence 상태 변화 구독 (친구 온/오프라인 실시간 반영)
  unsubscribePresence = SocialService.subscribePresence(() => {
    if (currentTab === "list") {
      void renderContent();
    }
  });

  await renderContent();
}
