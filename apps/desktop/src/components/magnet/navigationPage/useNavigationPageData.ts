import { useNavigation } from '../../../contexts/NavigationContext';
import { NavigationPageDataProps } from './NavigationPageTypes';

export function useNavigationPageData(): NavigationPageDataProps {
  const { currentPage } = useNavigation();
  return { currentPage };
}
