import { I18nManager, type LanguageCode } from './i18n';
type Copy = { loading: string; error: string; retry: string };
export const FRIENDS_COPY: Record<LanguageCode, Copy> = {
  ko: { loading: '친구 정보를 불러오는 중…', error: '친구 정보를 불러오지 못했습니다. 다시 시도해 주세요.', retry: '다시 시도' },
  en: { loading: 'Loading friends…', error: 'Could not load friends. Please try again.', retry: 'Try again' },
  ja: { loading: 'フレンド情報を読み込み中…', error: 'フレンド情報を読み込めませんでした。もう一度お試しください。', retry: '再試行' },
  'zh-CN': { loading: '正在加载好友信息…', error: '无法加载好友信息，请重试。', retry: '重试' },
  de: { loading: 'Freunde werden geladen…', error: 'Freunde konnten nicht geladen werden. Bitte erneut versuchen.', retry: 'Erneut versuchen' },
  fr: { loading: 'Chargement des amis…', error: 'Impossible de charger les amis. Veuillez réessayer.', retry: 'Réessayer' },
  es: { loading: 'Cargando amigos…', error: 'No se pudieron cargar los amigos. Inténtalo de nuevo.', retry: 'Reintentar' },
  ru: { loading: 'Загрузка друзей…', error: 'Не удалось загрузить друзей. Попробуйте ещё раз.', retry: 'Повторить' },
  'pt-BR': { loading: 'Carregando amigos…', error: 'Não foi possível carregar os amigos. Tente novamente.', retry: 'Tentar novamente' },
};
export const friendsCopy = (key: keyof Copy): string => FRIENDS_COPY[I18nManager.currentLang][key];
