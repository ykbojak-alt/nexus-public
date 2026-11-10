import {
  EmptyState,
  ErrorState,
  GlassSurface,
  LoadingState,
  UnavailableState,
} from '@nexus/ui';
import type {
  AssistantThemeId,
  CanonicalThemeId,
  EmptyStateProps,
  ErrorStateProps,
  GlassSurfaceProps,
  GlassTone,
  LoadingStateProps,
  NexusThemeDefinition,
  NexusThemeId,
  NexusThemeProviderProps,
  TokenKey,
  UnavailableStateProps,
} from '@nexus/ui';

const assistant: AssistantThemeId = 'arch';
const canonical: CanonicalThemeId = 'aurum-dark';
const theme: NexusThemeId = 'alice';
const token: TokenKey = 'color_gold_700';
const surfaceProps: GlassSurfaceProps = { variant: 'card', tone: assistant };
const tone: GlassTone = 'forge';
const loadingProps: LoadingStateProps = { children: 'Загрузка…', tone };
const emptyProps: EmptyStateProps = { title: 'Пусто', reason: 'фильтр пуст' };
const errorProps: ErrorStateProps = { title: 'Ошибка', retryLabel: 'Повторить' };
const unavailableProps: UnavailableStateProps = { title: 'Недоступно', reason: 'источник offline' };
const themeDefinition: NexusThemeDefinition = { id: theme, tokens: {} };
const providerProps: Pick<NexusThemeProviderProps, 'theme'> = { theme };

export const publicApiConsumerFixture = (
  <>
    <GlassSurface {...surfaceProps}>
      <LoadingState {...loadingProps} />
      <EmptyState {...emptyProps} />
      <ErrorState {...errorProps} />
      <UnavailableState {...unavailableProps} />
    </GlassSurface>
    <span data-audit={`${canonical}:${token}:${themeDefinition.id}:${providerProps.theme}`} />
  </>
);
