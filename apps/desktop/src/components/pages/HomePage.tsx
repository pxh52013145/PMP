import React from 'react';
import './HomePage.css';
import { useKernel } from '../../contexts/KernelApiContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { COMMANDS_SERVICE_TOKEN, dispatchCommandOrFallback } from '../../services/commands';

/**
 * 首页组件
 */
export const HomePage: React.FC = () => {
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const { navigateTo } = useNavigation();
  const t = useT();

  return (
    <div className="page-home">
      <div className="home-welcome">
        <div className="home-icon">♪</div>
        <h1 className="home-title">{t('pages.home.welcome.title')}</h1>
        <p className="home-subtitle">{t('pages.home.welcome.subtitle')}</p>

        <div className="home-actions">
          <button
            className="home-settings-link"
            onClick={() =>
              void dispatchCommandOrFallback(commands, 'app:navigate-settings', () =>
                navigateTo('settings')
              )
            }
          >
            {t('pages.settings.title')}
          </button>
        </div>
      </div>
    </div>
  );
};
