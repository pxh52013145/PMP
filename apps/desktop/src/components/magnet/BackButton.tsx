import { useNavigation } from '../../contexts/NavigationContext';
import './BackButton.css';

/**
 * 返回按钮组件
 */
export function BackButton() {
  const { goBack, history } = useNavigation();

  const canGoBack = history.length > 1;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (canGoBack) {
      console.log('Navigating back');
      goBack();
    }
  };

  return (
    <button
      className={`back-button ${!canGoBack ? 'back-button-disabled' : ''}`}
      onClick={handleClick}
      disabled={!canGoBack}
      title={canGoBack ? '返回' : '已在首页'}
    >
      <span className="back-button-icon">←</span>
    </button>
  );
}
