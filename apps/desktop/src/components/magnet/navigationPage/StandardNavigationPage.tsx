import React, { useEffect, useMemo, useState } from 'react';
import type { PageContribution } from '../../../contracts/contributions';
import { useKernel } from '../../../contexts/KernelContext';
import { NavigationPageVariantProps } from './NavigationPageTypes';
import './NavigationPage.css';

export const StandardNavigationPage: React.FC<NavigationPageVariantProps> = ({ data }) => {
  const { currentPage } = data;
  const kernel = useKernel();
  const [registryRevision, setRegistryRevision] = useState(0);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRegistryRevision((value) => value + 1));
  }, [kernel.contributions]);

  const contribution = useMemo(() => {
    void registryRevision;
    return kernel.contributions.get<PageContribution>('page', currentPage.type);
  }, [currentPage.type, kernel.contributions, registryRevision]);

  const content = contribution ? (contribution.render(currentPage) as React.ReactNode) : null;
  const title = currentPage.type === 'home' ? '主页面' : contribution?.title ?? currentPage.type;

  return (
    <div className="navigation-page">
      <div className="navigation-content">
        {content ?? (
          <Placeholder
            icon="?"
            text={`未注册页面：${String(currentPage.type)}`}
            cssClass="page-unknown"
          />
        )}
      </div>

      <div className="navigation-footer">
        <div className="page-info">{title}</div>
      </div>
    </div>
  );
};

function Placeholder({
  icon,
  text,
  cssClass,
}: {
  icon: string;
  text: string;
  cssClass?: string;
}) {
  return (
    <div className={`page-placeholder ${cssClass || ''}`}>
      <div className="placeholder-icon">{icon}</div>
      <div className="placeholder-text">{text}</div>
    </div>
  );
}

