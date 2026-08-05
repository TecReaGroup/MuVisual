import { Languages } from 'lucide-react';
import { useI18n } from './I18nProvider';

export function LanguageButton() {
  const { t, toggleLanguage } = useI18n();

  return <button
    className="language-button"
    type="button"
    onClick={toggleLanguage}
    aria-label={t('language.switch')}
    title={t('language.switch')}
  >
    <Languages size={16} aria-hidden="true" />
    <span>{t('language.current')}</span>
  </button>;
}
