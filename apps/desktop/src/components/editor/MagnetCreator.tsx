import { useState, useEffect, useMemo, useCallback } from 'react';
import { Magnet, PixelAnchor, AnchorType } from '../../types/pixel';
import { open } from '@tauri-apps/api/dialog';
import { readTextFile } from '@tauri-apps/api/fs';
import { useEditor } from '../../contexts/EditorContext';
import { MagnetComponent } from '../magnet/Magnet';
import { computeMagnetVisualBounds } from '../../modules/magnets/geometry';
import { getMagnetOccupiedPixels } from '../../utils/magnetEditor';
import {
  appendMagnetHistory,
  loadMagnetHistory,
  saveMagnetHistory,
  type MagnetHistoryItem,
} from './magnetCreatorHistory';
import {
  type InsetDraft,
  INSET_SIDES,
  PREVIEW_PIXEL_POSITIONS,
  PREVIEW_STAGE_SIZE,
  buildAnchorsFromOrigin,
  buildEditorMagnet,
  createEmptyInsetDraft,
  createInsetDraft,
  getPreviewScaleFromBounds,
  hasMagnetConfigChanges,
  parseInsetDraft,
} from './magnetCreatorModel';
import { createDefaultBoundsForMagnet } from '../../modules/magnets/layoutPresets';
import { DEFAULT_MAGNET_TRANSITION } from '../../modules/magnets/chromePresets';
import { useLocale, useT } from '../../i18n';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import './MagnetCreator.css';

const telemetry = getTelemetryLogger('editor', 'MagnetCreator');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface MagnetCreatorProps {
  mode: 'create' | 'edit';
  editingMagnet?: Magnet;
  defaultMagnet?: Magnet; // 濮掓稒顭堥濠氭煀瀹ュ洨鏋傞柨娑樼墢閺併倖绂嶆惔銈囩闁告鍣﹂敓?
  onSave: (magnet: Magnet) => void;
  onCancel: () => void;
}

// 闁告ê妫楄ぐ鍓佹媼閺夎法绉块柟鎭掑劚閿?
type MagnetHistory = MagnetHistoryItem;

export function MagnetCreator({
  mode,
  editingMagnet,
  defaultMagnet,
  onSave,
  onCancel,
}: MagnetCreatorProps) {
  const t = useT();
  const locale = useLocale();

  // 闁兼儳鍢茶ぐ鍥╃磽閺嶎剛甯嗛柛锝冨妺缁楀倹绋夌€ｎ偅鐎柨娑樼墢閺併倖绂嶆惔鈥虫毐缂佹劒鐒﹂ˉ鍛圭€ｅ墎绀?
  const { occupancyMap } = useEditor();

  // 閻炴稏鍔屽畷鐔衡偓娑欘殕椤斿矂鎮╅懜纰樺亾?
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [anchorType, setAnchorType] = useState<AnchorType>('single');
  const [content, setContent] = useState('');
  const [chromeInsetDraft, setChromeInsetDraft] = useState<InsetDraft>(createEmptyInsetDraft());
  const [chromeOutsetDraft, setChromeOutsetDraft] = useState<InsetDraft>(createEmptyInsetDraft());

  // 闂佹寧姘ㄩ崑锝夋煀瀹ュ洨鏋?- pixel 閻忓繐鎼敓?
  const [horizontalPixels, setHorizontalPixels] = useState(5); // 婵ɑ娼欓柦鈺呭棘閻熺増鍊?pixel 闁轰椒鍗抽敓?
  const [verticalPixels, setVerticalPixels] = useState(3); // 闁搞劌鍊诲ú鍧楀棘閻熺増鍊?pixel 闁轰椒鍗抽敓?
  const [rectWidth, setRectWidth] = useState(5); // 闁活厸鏅涢懜鎵偓纭呮鐎规娊鏁嶉崸顪痻el閿?
  const [rectHeight, setRectHeight] = useState(3); // 闁活厸鏅涢懜鐗堫殗濡搫顔婇柨娑樻椒ixel閿?

  // 闁哄秴鍢茬槐锟犳煀瀹ュ洨鏋傞柨娑樻篂SON 閻庢稒顨堥浣圭▔鐠囇呯
  const [styleJson, setStyleJson] = useState<string>(`{
  "width": "36px",
  "height": "36px",
  "backgroundColor": "rgba(0, 0, 0, 0.7)",
  "borderRadius": "2.7px",
  "display": "flex",
  "alignItems": "center",
  "justifyContent": "center",
  "cursor": "pointer"
}`);
  const [boundsJson, setBoundsJson] = useState<string>(() =>
    JSON.stringify(createDefaultBoundsForMagnet('single', { width: '36px', height: '36px' }), null, 2)
  );

  // 闁告柣鍔庨弫楣冩煀瀹ュ洨鏋傞柨娑樻篂SON 閻庢稒顨堥浣圭▔鐠囇呯
  const [animationJson, setAnimationJson] = useState<string>(() =>
    JSON.stringify(
      {
        transition: DEFAULT_MAGNET_TRANSITION,
        hoverStyle: {
          transform: 'scale(1.05)',
          filter: 'brightness(1.1)',
        },
        activeStyle: {
          transform: 'scale(0.95)',
          filter: 'brightness(0.9)',
        },
      },
      null,
      2
    )
  );

  // 闁哄秴鍢茬槐锛勬喆閿濆棛鈧粙鏌ㄥ▎鎺濆殩
  const [styleError, setStyleError] = useState('');
  const [boundsError, setBoundsError] = useState('');
  const [animationError, setAnimationError] = useState('');

  // 閻庣數鍘ч崣鍡涙偐閼哥鍋?
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  // 闁告ê妫楄ぐ鍓佹媼閺夎法绉块柣鈺冾焾閿?
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<MagnetHistory[]>([]);
  const [sourceMagnet, setSourceMagnet] = useState<Magnet | null>(editingMagnet ?? null);

  // 闁哄嫷鍨伴幆浣圭▔閸濆嫬鏁堕敓?Magnet闁挎稑鐗嗛崹浠嬪棘椤撶喐笑闁告熬闄勫Ο澶岀矆妤﹁法绠烽柛妯煎枑鐎垫粓鏌﹂鍡欑
  const isBuiltinMagnet = useMemo(() => {
    return mode === 'edit' && defaultMagnet !== undefined;
  }, [mode, defaultMagnet]);

  // 閻熸瑱绲鹃悗浠嬪冀瀹勬壆纭€ JSON
  const parsedStyle = useMemo(() => {
    try {
      const parsed = JSON.parse(styleJson);
      setStyleError('');
      return parsed;
    } catch (error) {
      setStyleError('common.error.jsonFormat');
      return {};
    }
  }, [styleJson]);

  // 閻熸瑱绲鹃悗浠嬪礉閵娧勬毎 JSON
  const parsedAnimation = useMemo(() => {
    try {
      const parsed = JSON.parse(animationJson);
      setAnimationError('');
      return parsed;
    } catch (error) {
      setAnimationError('common.error.jsonFormat');
      return undefined;
    }
  }, [animationJson]);

  const parsedChromeInset = useMemo(() => parseInsetDraft(chromeInsetDraft), [chromeInsetDraft]);
  const parsedChromeOutset = useMemo(() => parseInsetDraft(chromeOutsetDraft), [chromeOutsetDraft]);

  const parsedBounds = useMemo(() => {
    try {
      const parsed = JSON.parse(boundsJson) as Magnet['bounds'];
      if (
        !parsed ||
        !parsed.horizontal?.start ||
        !parsed.horizontal?.end ||
        !parsed.vertical?.start ||
        !parsed.vertical?.end
      ) {
        throw new Error('invalid-bounds');
      }

      setBoundsError('');
      return parsed;
    } catch (error) {
      setBoundsError('common.error.jsonFormat');
      return undefined;
    }
  }, [boundsJson]);

  const anchorDimensions = useMemo(
    () => ({ horizontalPixels, verticalPixels, rectWidth, rectHeight }),
    [horizontalPixels, verticalPixels, rectWidth, rectHeight]
  );


  // 闁告梻濮鹃敓?Magnet 闂佹澘绉堕悿鍡涙儍閸曨喚绐￠柛鏂烘櫅閸ら亶寮?
  const loadMagnetConfig = useCallback((magnet: Magnet) => {
    setSourceMagnet(magnet);
    setId(magnet.id);
    setName(magnet.name);
    setAnchorType(magnet.anchorType);
    setContent(typeof magnet.content === 'string' ? magnet.content : '');
    setBoundsJson(JSON.stringify(magnet.bounds, null, 2));
    setChromeInsetDraft(createInsetDraft(magnet.chrome?.inset));
    setChromeOutsetDraft(createInsetDraft(magnet.chrome?.outset));

    // 闁告梻濮惧ù鍥煥濮樺崬浠梺鏉跨Ф閻ゅ棝鐛幆閭﹀悁閿?pixel 閻忓繐鎼敓?
    if (magnet.anchors.length >= 2) {
      if (magnet.anchorType === 'horizontal') {
        const width = Math.abs(magnet.anchors[1].gridX - magnet.anchors[0].gridX) + 1;
        setHorizontalPixels(width);
      } else if (magnet.anchorType === 'vertical') {
        const height = Math.abs(magnet.anchors[1].gridY - magnet.anchors[0].gridY) + 1;
        setVerticalPixels(height);
      } else if (magnet.anchorType === 'rectangular') {
        const width = Math.abs(magnet.anchors[1].gridX - magnet.anchors[0].gridX) + 1;
        const height = Math.abs(magnet.anchors[2].gridY - magnet.anchors[0].gridY) + 1;
        setRectWidth(width);
        setRectHeight(height);
      }
    }

    // 闁告梻濮惧ù鍥冀瀹勬壆纭€ JSON
    if (magnet.style) {
      setStyleJson(JSON.stringify(magnet.style, null, 2));
    }

    // 闁告梻濮惧ù鍥礉閵娧勬毎 JSON
    if (magnet.animation) {
      setAnimationJson(JSON.stringify(magnet.animation, null, 2));
    }
  }, []);

  // 闁告梻濮惧ù鍥╃磽閺嶎剛甯嗛柡浣哄閿?
  useEffect(() => {
    if (mode === 'edit' && editingMagnet) {
      loadMagnetConfig(editingMagnet);
      // 闁告梻濮惧ù鍥储閸℃钑夐悹浣规緲閿?
      setHistory(loadMagnetHistory(editingMagnet.id));
    }
  }, [mode, editingMagnet, loadMagnetConfig]);

  // 闁哄秷顫夊畵渚€鏌ㄥ鍗炰化缂侇偉顕ч悗鐑藉椽?pixel 閻忓繐鎼顓㈡偨閻旂鐏囬梺鎸庢皑閿?
  const generateAnchors = useMemo((): PixelAnchor[] => {
    return buildAnchorsFromOrigin(anchorType, 10, 10, anchorDimensions);
  }, [anchorType, anchorDimensions]);

  // 濡ょ姴鐭侀惁澶愭煥濮樺崬浠柡鍕靛灠閹胶鎼鹃崨顓炴瘔缂傚啯鍨堕悧鍛婃綇閸︻厽娅?
  const anchorsValidation = useMemo(() => {
    const maxX = 26; // 缂傚啯鍨堕悧鎼佸嫉閳ь剚寰?X 闁秆勫姈閿?
    const maxY = 19; // 缂傚啯鍨堕悧鎼佸嫉閳ь剚寰?Y 闁秆勫姈閿?
    const errors: string[] = [];
    const warnings: string[] = [];

    // 闁革负鍔庣槐顏呮綇閹寸伣浣割嚕韫囧海鐟撻柨娑樿嫰閻斺偓濞存粌楠搁悿鍕⒔閸涱剛绉寸紓鍐惧櫍閻涙瑧鎷犳笟濠勫耿闁革负鍔岄崹鍗烆嚈閻戞◥浣割嚕韫囧海鐟撻柨娑樿嫰閻斺偓濞存粌楠搁弰鍌溾偓鍨倐閻涙瑧鎷?
    let anchorsToValidate: PixelAnchor[];

    if (mode === 'edit' && editingMagnet) {
      const baseAnchor = editingMagnet.anchors[0];
      const baseX = baseAnchor.gridX;
      const baseY = baseAnchor.gridY;

      anchorsToValidate = buildAnchorsFromOrigin(anchorType, baseX, baseY, anchorDimensions);
    } else {
      // 闁告帗绋戠紓鎾澄熼垾宕囩闁挎稒鐭繛鍥偨閵娾晩鏆曢悷娆忕墦閺佸鎮欒ぐ鎺斿矗閿?
      anchorsToValidate = generateAnchors;
    }

    // 濡ょ姴鐭侀惁澶愭煥濮樺崬浠柛褎鍔栭敓?
    anchorsToValidate.forEach((anchor) => {
      if (anchor.gridX < 0 || anchor.gridX > maxX) {
        errors.push(
          t('editor.magnet-creator.validation.anchorOutOfRangeX', {
            id: anchor.id,
            value: anchor.gridX,
          })
        );
      }
      if (anchor.gridY < 0 || anchor.gridY > maxY) {
        errors.push(
          t('editor.magnet-creator.validation.anchorOutOfRangeY', {
            id: anchor.id,
            value: anchor.gridY,
          })
        );
      }
    });

    // 闁革负鍔庣槐顏呮綇閹寸伣浣割嚕韫囧海鐟撻柨娑樻湰椤ュ懘寮婚妷锔叫﹂柛姘剧細缁楀矂宕楅張鐢甸搨 magnet 闁告劘灏欓敓?
    if (mode === 'edit' && editingMagnet && anchorsToValidate.length > 0) {
      // 闁告帗绋戠紓鎾寸▔鐎涙ɑ顦?magnet 閻庣數顢婇挅鍕晬鐏炵厧鈻忛柣顫妽閺屽﹪鎯冮崟顖涙櫔闁绘劗鎳撻幏鎵尵鐠囪鎷?
      const tempMagnet: Magnet = {
        ...editingMagnet,
        anchorType,
        anchors: anchorsToValidate,
      };

      // 閻犱緤绱曢悾濠氬棘閺夋寧妲€閻庣敻鏅茬粭鍛村础閻樺灚鏆忛敓?pixels
      const occupiedPixels = getMagnetOccupiedPixels(tempMagnet);

      // 婵☆偀鍋撻柡灞诲劚閸熻法绮?
      const conflictingPixels: Array<{ x: number; y: number; occupiedBy: string }> = [];
      occupiedPixels.forEach((pixel) => {
        const key = `${pixel.x},${pixel.y}`;
        const occupancy = occupancyMap.get(key);

        // 濠碘€冲€归敓?pixel 閻炴凹鍋勫畷浼存偨椤帞绀夊☉鎾存煣缁楀寮伴婵愭蕉鐟滅増鎸告晶鐘电磽閺嶎剛甯嗛敓?magnet 闁告濮烽敓?
        if (
          occupancy?.isOccupied &&
          occupancy.occupiedBy &&
          occupancy.occupiedBy !== editingMagnet.id
        ) {
          conflictingPixels.push({
            x: pixel.x,
            y: pixel.y,
            occupiedBy: occupancy.occupiedBy,
          });
        }
      });

      // 濠碘€冲€归悘澶愬嫉婢跺﹤鏆辩紒鎰筏缁辨繂菐鐠囨彃顫ｉ梺鎸庣懆椤曘倖绌遍埄鍐х礀
      if (conflictingPixels.length > 0) {
        // 缂備胶鍠曢鎼佸礃閼碱剛宕愰敓?magnet
        const conflictingMagnets = new Set(conflictingPixels.map((p) => p.occupiedBy));
        errors.push(
          t('editor.magnet-creator.validation.conflict', {
            magnets: conflictingMagnets.size,
            pixels: conflictingPixels.length,
          })
        );
      }
    }

    // 闁告帗绋戠紓鎾澄熼垾宕囩濞戞挸顑囧▓鎴烇紣閸曨噮娼斿ù锝呯Ф閻ゅ棝骞撻幇顔轰粵
    if (mode === 'create') {
      if (anchorType === 'horizontal' && horizontalPixels > 17) {
        warnings.push(t('editor.magnet-creator.validation.largeWidthWarning'));
      }
      if (anchorType === 'vertical' && verticalPixels > 10) {
        warnings.push(t('editor.magnet-creator.validation.largeHeightWarning'));
      }
      if (anchorType === 'rectangular') {
        if (rectWidth > 17) warnings.push(t('editor.magnet-creator.validation.largeWidthWarning'));
        if (rectHeight > 10) warnings.push(t('editor.magnet-creator.validation.largeHeightWarning'));
      }
    }

    return { hasErrors: errors.length > 0, errors, warnings };
  }, [
    mode,
    editingMagnet,
    generateAnchors,
    anchorDimensions,
    anchorType,
    horizontalPixels,
    verticalPixels,
    rectWidth,
    rectHeight,
    occupancyMap,
    t,
  ]);
  const previewMagnet = useMemo<Magnet | null>(() => {
    if (!id || !name || !parsedBounds) return null;

    return buildEditorMagnet({
      seedMagnet: sourceMagnet ?? undefined,
      id,
      name,
      anchorType,
      anchors: generateAnchors,
      bounds: parsedBounds,
      content,
      style: parsedStyle,
      animation: parsedAnimation,
      chromeInset: parsedChromeInset,
      chromeOutset: parsedChromeOutset,
    });
  }, [
    anchorType,
    content,
    generateAnchors,
    id,
    name,
    parsedAnimation,
    parsedBounds,
    parsedChromeInset,
    parsedChromeOutset,
    parsedStyle,
    sourceMagnet,
  ]);

  const previewBounds = useMemo(() => {
    if (!previewMagnet) return null;
    return computeMagnetVisualBounds(previewMagnet, PREVIEW_PIXEL_POSITIONS);
  }, [previewMagnet]);

  const previewScale = useMemo(() => getPreviewScaleFromBounds(previewBounds), [previewBounds]);

  const handleSave = () => {
    if (!id || !name || !parsedBounds) return;

    const anchorsToSave =
      mode === 'edit' && editingMagnet
        ? buildAnchorsFromOrigin(
            anchorType,
            editingMagnet.anchors[0].gridX,
            editingMagnet.anchors[0].gridY,
            anchorDimensions
          )
        : generateAnchors;

    const magnetToSave = buildEditorMagnet({
      seedMagnet: sourceMagnet ?? editingMagnet ?? undefined,
      fallbackType: editingMagnet?.type ?? 'custom',
      fallbackInteractions: editingMagnet?.interactions,
      id,
      name,
      anchorType,
      anchors: anchorsToSave,
      bounds: parsedBounds,
      content,
      style: parsedStyle,
      animation: parsedAnimation,
      chromeInset: parsedChromeInset,
      chromeOutset: parsedChromeOutset,
    });

    const lastMagnet = mode === 'edit' && history.length > 0 ? history[0].magnet : null;

    if (hasMagnetConfigChanges(lastMagnet, magnetToSave)) {
      appendMagnetHistory(
        magnetToSave,
        mode === 'create'
          ? 'editor.magnet-creator.history.created'
          : 'editor.magnet-creator.history.editedSave'
      );
    }

    onSave(magnetToSave);
    onCancel();
  };


  // 閺夆晜锚鐢偊宕氭导瀵稿笡閻犱降鍊濋崢銈囩磾?
  const handleRestore = () => {
    if (!defaultMagnet) return;
    loadMagnetConfig(defaultMagnet);
    appendMagnetHistory(defaultMagnet, 'editor.magnet-creator.history.restoreDefault');
  };

  // 閹煎瓨姊婚弫銈夊储閸℃钑夐悹浣规緲閿?
  const handleApplyHistory = (historyItem: MagnetHistory) => {
    loadMagnetConfig(historyItem.magnet);
    setShowHistory(false);
  };

  // 閻庣數鍘ч崣鍡涙煀瀹ュ洨鏋傞柨娑樼墔缁娀寮崶銊︽嫳婵℃妫撮敓?
  const handleImport = () => {
    try {
      const data = JSON.parse(importJson);

      // 濡ょ姴鐭侀惁澶庣疀閸涱叏缍栭悗娑欘殕閿?
      if (!data.id) throw new Error(t('editor.magnet-creator.import.missingField.id'));
      if (!data.name) throw new Error(t('editor.magnet-creator.import.missingField.name'));
      if (!data.anchorType) throw new Error(t('editor.magnet-creator.import.missingField.anchorType'));
      if (!data.bounds) throw new Error(t('editor.magnet-creator.import.missingField.bounds'));
      if (!data.style) throw new Error(t('editor.magnet-creator.import.missingField.style'));

      // 闁告梻濮惧ù鍥煀瀹ュ洨鏋?
      loadMagnetConfig(data as Magnet);
      setShowImport(false);
      setImportJson('');
      setImportError('');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'editor.magnet-creator.import.failed');
    }
  };

  // 濞寸姴瀛╅弸鍐╃鐠轰警鍤ら敓?
  const handleImportFromFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
        title: t('editor.magnet-creator.import.dialogTitle'),
      });

      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        setImportJson(content);
        setImportError('');
      }
    } catch (error) {
      telemetry.error('editor.magnet.import-file.failed', {
        message: getErrorMessage(error),
      });
      setImportError(
        error instanceof Error ? error.message : 'editor.magnet-creator.import.readFileFailed'
      );
    }
  };

  // 閻庣數鍘ч崵顓㈡煀瀹ュ洨鏋?
  const handleExport = () => {
    if (!previewMagnet) return;

    const exportData = {
      id: previewMagnet.id,
      type: previewMagnet.type,
      renderer: previewMagnet.renderer,
      previewText: previewMagnet.previewText,
      description: previewMagnet.description,
      tags: previewMagnet.tags,
      variant: previewMagnet.variant,
      skinProps: previewMagnet.skinProps,
      name: previewMagnet.name,
      anchorType: previewMagnet.anchorType,
      anchors: previewMagnet.anchors,
      bounds: previewMagnet.bounds,
      content: previewMagnet.content,
      style: previewMagnet.style,
      chrome: previewMagnet.chrome,
      animation: previewMagnet.animation,
      state: previewMagnet.state,
      interactions: {
        draggable: previewMagnet.interactions.draggable,
        clickable: previewMagnet.interactions.clickable,
      },
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    navigator.clipboard
      .writeText(jsonStr)
      .then(() => {
        alert(t('editor.magnet-creator.export.copySuccess'));
      })
      .catch(() => {
        alert(t('editor.magnet-creator.export.copyFailed'));
        telemetry.warn('editor.magnet.export.clipboard-copy.failed', {
          fields: {
            fallbackBytes: jsonStr.length,
          },
        });
      });
  };

  // 闁告帞濞€濞呭酣宕㈤崱妤€钑夐悹浣规緲閿?
  const handleDeleteHistory = (historyId: string) => {
    const newHistory = history.filter((h) => h.id !== historyId);
    setHistory(newHistory);
    if (editingMagnet) {
      saveMagnetHistory(editingMagnet.id, newHistory);
    }
  };

  // 濡ょ姴鐭侀惁澶屾偘閵娿儱绀?
  const isValid = id && name && !anchorsValidation.hasErrors && !boundsError && !styleError && !animationError;



  return (
    <div className="editor-creator">
      {/* 闁归攱鐗曟慨鈺呭冀閸ヮ剦鏆敓?*/}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('windows.editor.creator.title')}
        </span>
      </div>

      {/* 闁搞儱鎼悾鐐紣閸曨噮娼旈柛鏍ф惈閿?*/}
      <div className="creator-preview-fixed">
        <div className="creator-section-title">{t('editor.magnet-creator.preview.title')}</div>
        {previewMagnet ? (
          <>
            <div className="creator-preview">
              <div
                className="creator-preview-content"
                style={{
                  transform: `scale(${previewScale})`,
                  transition: 'transform 0.2s ease',
                }}
              >
                <div
                  className="creator-preview-stage"
                  style={{
                    width: `${PREVIEW_STAGE_SIZE}px`,
                    height: `${PREVIEW_STAGE_SIZE}px`,
                  }}
                >
                  <MagnetComponent magnet={previewMagnet} pixelPositions={PREVIEW_PIXEL_POSITIONS} />
                </div>
              </div>
            </div>
            <div className="creator-preview-hint">
              {t('editor.magnet-creator.preview.hintHover')}
              <br />
              {t('editor.magnet-creator.preview.hintActive')}
              {previewBounds && previewScale < 1 && (
                <>
                  <br />
                  <span style={{ color: 'rgba(255, 204, 0, 0.9)' }}>
                    {t('editor.magnet-creator.preview.scaled', {
                      percent: Math.round(previewScale * 100),
                    })}
                  </span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="creator-preview-empty">{t('editor.magnet-creator.preview.empty')}</div>
        )}
      </div>

      {/* 闁告劕鎳庨鎰板礌閸濆嫮鍘?*/}
      <div className="editor-window-content">
        {/* 婵☆垪鈧磭纭€闁哄秴娲敓?*/}
        <div className="creator-mode-title">
          {mode === 'edit'
            ? t('editor.magnet-creator.mode.edit')
            : t('editor.magnet-creator.mode.create')}
        </div>

        {/* 闊洤鎳庨敐鐐碘偓娑欘殕閿?*/}
        <div className="creator-section">
          <div className="creator-section-title">{t('editor.magnet-creator.section.basic')}</div>
          <div className="creator-form">
            {/* ID */}
            <div className="creator-form-row">
              <label className="creator-label">
                {t('editor.magnet-creator.field.id')} <span className="creator-required">*</span>
              </label>
              <input
                type="text"
                className="creator-input"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="my-magnet"
                disabled={mode === 'edit'}
              />
            </div>

            {/* Name */}
            <div className="creator-form-row">
              <label className="creator-label">
                {t('editor.magnet-creator.field.name')} <span className="creator-required">*</span>
              </label>
              <input
                type="text"
                className="creator-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('editor.magnet-creator.field.name.placeholder')}
              />
            </div>

            {/* Content */}
            <div className="creator-form-row">
              <label className="creator-label">{t('editor.magnet-creator.field.content')}</label>
              <input
                type="text"
                className="creator-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('editor.magnet-creator.field.content.placeholder')}
              />
            </div>

            {/* Anchor Type */}
            <div className="creator-form-row">
              <label className="creator-label">
                {t('editor.magnet-creator.field.anchorType')}{' '}
                <span className="creator-required">*</span>
              </label>
              <select
                className="creator-select"
                value={anchorType}
                onChange={(e) => {
                  const nextAnchorType = e.target.value as AnchorType;
                  setAnchorType(nextAnchorType);
                  setBoundsJson(JSON.stringify(createDefaultBoundsForMagnet(nextAnchorType, parsedStyle), null, 2));
                }}
              >
                <option value="single">{t('editor.magnet-creator.anchorType.single')}</option>
                <option value="horizontal">{t('editor.magnet-creator.anchorType.horizontal')}</option>
                <option value="vertical">{t('editor.magnet-creator.anchorType.vertical')}</option>
                <option value="rectangular">
                  {t('editor.magnet-creator.anchorType.rectangular')}
                </option>
              </select>
            </div>

            {/* Horizontal Pixel Count */}
            {anchorType === 'horizontal' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">
                    {t('editor.magnet-creator.field.horizontalPixels')}
                  </label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={horizontalPixels}
                      onChange={(e) => setHorizontalPixels(parseInt(e.target.value))}
                      min="1"
                      max="27"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={horizontalPixels}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setHorizontalPixels(Math.max(1, Math.min(27, val)));
                      }}
                      min="1"
                      max="27"
                    />
                  </div>
                </div>
                {/* 濡ょ姴鐭侀惁澶愬箵閹邦喓浠?- 婵ɑ娼欓敓?*/}
                {anchorsValidation.hasErrors && (
                  <div className="creator-validation-error">
                    闁宠法濯撮敓?{t('editor.magnet-creator.validation.outOfBounds')}
                    {anchorsValidation.errors.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                )}
                {!anchorsValidation.hasErrors && anchorsValidation.warnings.length > 0 && (
                  <div className="creator-validation-warning">
                    閿?{t('editor.magnet-creator.validation.hintTitle')}
                    {anchorsValidation.warnings.map((warn, i) => (
                      <div key={i}>{warn}</div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Vertical Pixel Count */}
            {anchorType === 'vertical' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">
                    {t('editor.magnet-creator.field.verticalPixels')}
                  </label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={verticalPixels}
                      onChange={(e) => setVerticalPixels(parseInt(e.target.value))}
                      min="1"
                      max="20"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={verticalPixels}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setVerticalPixels(Math.max(1, Math.min(20, val)));
                      }}
                      min="1"
                      max="20"
                    />
                  </div>
                </div>
                {/* 濡ょ姴鐭侀惁澶愬箵閹邦喓浠?- 闁搞劌鍊婚敓?*/}
                {anchorsValidation.hasErrors && (
                  <div className="creator-validation-error">
                    闁宠法濯撮敓?{t('editor.magnet-creator.validation.outOfBounds')}
                    {anchorsValidation.errors.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                )}
                {!anchorsValidation.hasErrors && anchorsValidation.warnings.length > 0 && (
                  <div className="creator-validation-warning">
                    閿?{t('editor.magnet-creator.validation.hintTitle')}
                    {anchorsValidation.warnings.map((warn, i) => (
                      <div key={i}>{warn}</div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Rectangular Dimensions */}
            {anchorType === 'rectangular' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">{t('editor.magnet-creator.field.rectWidth')}</label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={rectWidth}
                      onChange={(e) => setRectWidth(parseInt(e.target.value))}
                      min="1"
                      max="27"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={rectWidth}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setRectWidth(Math.max(1, Math.min(27, val)));
                      }}
                      min="1"
                      max="27"
                    />
                  </div>
                </div>
                <div className="creator-form-row">
                  <label className="creator-label">
                    {t('editor.magnet-creator.field.rectHeight')}
                  </label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={rectHeight}
                      onChange={(e) => setRectHeight(parseInt(e.target.value))}
                      min="1"
                      max="20"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={rectHeight}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setRectHeight(Math.max(1, Math.min(20, val)));
                      }}
                      min="1"
                      max="20"
                    />
                  </div>
                </div>
                {/* 濡ょ姴鐭侀惁澶愬箵閹邦喓浠?- 闁活厸鏅涢敓?*/}
                {anchorsValidation.hasErrors && (
                  <div className="creator-validation-error">
                    闁宠法濯撮敓?{t('editor.magnet-creator.validation.outOfBounds')}
                    {anchorsValidation.errors.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                )}
                {!anchorsValidation.hasErrors && anchorsValidation.warnings.length > 0 && (
                  <div className="creator-validation-warning">
                    閿?{t('editor.magnet-creator.validation.hintTitle')}
                    {anchorsValidation.warnings.map((warn, i) => (
                      <div key={i}>{warn}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 闁哄秴鍢茬槐锟犳煀瀹ュ洨鏋?*/}
        <div className="creator-section">
          <div className="creator-section-title">{t('editor.magnet-creator.section.layout')}</div>
          <div className="creator-form">
            <div className="creator-layout-hint">{t('editor.magnet-creator.layout.hint')}</div>
            <div className="creator-layout-subsection">
              <div className="creator-layout-subtitle">
                {t('editor.magnet-creator.layout.boundsTitle')}
              </div>
              <div className="creator-layout-hint">{t('editor.magnet-creator.layout.boundsHint')}</div>
              <div className="creator-form-column">
                <textarea
                  className="creator-textarea"
                  value={boundsJson}
                  onChange={(e) => setBoundsJson(e.target.value)}
                  placeholder='{"horizontal":{"start":{"source":"slot","edge":"center","offset":-18},"end":{"source":"slot","edge":"center","offset":18}},"vertical":{"start":{"source":"slot","edge":"center","offset":-18},"end":{"source":"slot","edge":"center","offset":18}}}'
                  rows={12}
                />
                {boundsError && <div className="creator-error">{t(boundsError)}</div>}
              </div>
            </div>

            <div className="creator-layout-subsection">
              <div className="creator-layout-subtitle">
                {t('editor.magnet-creator.layout.chromeInsetTitle')}
              </div>
              <div className="creator-layout-hint">
                {t('editor.magnet-creator.layout.chromeInsetHint')}
              </div>
              <div className="creator-layout-grid">
                {INSET_SIDES.map((side) => (
                  <div key={`chrome-${side}`} className="creator-form-column">
                    <label className="creator-label">
                      {t(`editor.magnet-creator.field.chromeInset${side[0].toUpperCase()}${side.slice(1)}`)}
                    </label>
                    <input
                      type="number"
                      className="creator-input creator-input-number creator-layout-input"
                      value={chromeInsetDraft[side]}
                      onChange={(e) =>
                        setChromeInsetDraft((current) => ({
                          ...current,
                          [side]: e.target.value,
                        }))
                      }
                      min="0"
                      step="1"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="creator-layout-subsection">
              <div className="creator-layout-subtitle">
                {t('editor.magnet-creator.layout.chromeOutsetTitle')}
              </div>
              <div className="creator-layout-hint">
                {t('editor.magnet-creator.layout.chromeOutsetHint')}
              </div>
              <div className="creator-layout-grid">
                {INSET_SIDES.map((side) => (
                  <div key={`chrome-outset-${side}`} className="creator-form-column">
                    <label className="creator-label">
                      {t(`editor.magnet-creator.field.chromeOutset${side[0].toUpperCase()}${side.slice(1)}`)}
                    </label>
                    <input
                      type="number"
                      className="creator-input creator-input-number creator-layout-input"
                      value={chromeOutsetDraft[side]}
                      onChange={(e) =>
                        setChromeOutsetDraft((current) => ({
                          ...current,
                          [side]: e.target.value,
                        }))
                      }
                      min="0"
                      step="1"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="creator-section">
          <div className="creator-section-title">{t('editor.magnet-creator.section.styleJson')}</div>
          <div className="creator-form">
            <div className="creator-form-column">
              <label className="creator-label">
                {t('editor.magnet-creator.styleJson.label')} <span className="creator-required">*</span>
              </label>
              <textarea
                className="creator-textarea"
                value={styleJson}
                onChange={(e) => setStyleJson(e.target.value)}
                placeholder='{"width": "36px", "height": "36px", ...}'
                rows={10}
              />
              {styleError && <div className="creator-error">{t(styleError)}</div>}
              <div className="creator-hint">
                {t('editor.magnet-creator.styleJson.commonStyles')}
              </div>
            </div>
          </div>
        </div>

        {/* 闁告柣鍔庨弫楣冩煀瀹ュ洨鏋?*/}
        <div className="creator-section">
          <div className="creator-section-title">
            {t('editor.magnet-creator.section.animationJson')}
          </div>
          <div className="creator-form">
            <div className="creator-form-column">
              <label className="creator-label">{t('editor.magnet-creator.animationJson.label')}</label>
              <textarea
                className="creator-textarea"
                value={animationJson}
                onChange={(e) => setAnimationJson(e.target.value)}
                placeholder='{"transition": "opacity 140ms ease, transform 140ms ease", "hoverStyle": {...}, "activeStyle": {...}}'
                rows={12}
              />
              {animationError && <div className="creator-error">{t(animationError)}</div>}
              <div className="creator-hint">
                妫ｅ啯瀵?{t('editor.magnet-creator.animation.hint.title')}
                <br />閿?<strong>transition</strong>: {t('editor.magnet-creator.animation.hint.transition')}
                <br />閿?<strong>hoverStyle</strong>:{' '}
                {t('editor.magnet-creator.animation.hint.hoverStyle')}
                <br />閿?<strong>activeStyle</strong>:{' '}
                {t('editor.magnet-creator.animation.hint.activeStyle')}
                <br />
                <br />
                {t('editor.magnet-creator.animation.hint.commonProps')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 閹煎瓨娲熼崕鎾炊閸濆嫮鏆伴柟绋款樀閿?*/}
      <div className="creator-footer-fixed">
        <button className="creator-btn creator-btn-cancel" onClick={onCancel}>
          {t('common.action.cancel')}
        </button>
        {isBuiltinMagnet && (
          <button className="creator-btn creator-btn-restore" onClick={handleRestore}>
            {t('editor.magnet-creator.action.restoreDefault')}
          </button>
        )}
        {mode === 'edit' && (
          <button
            className="creator-btn creator-btn-history"
            onClick={() => setShowHistory(!showHistory)}
          >
            {history.length > 0
              ? t('editor.magnet-creator.action.historyWithCount', { count: history.length })
              : t('editor.magnet-creator.action.history')}
          </button>
        )}
        {/* 闁告帗绋戠紓鎾澄熼垾宕囩闁挎稒纰嶅Ο澶岀矆閸濆嫷鍤ら柛蹇嬪劜鐎垫粓鏌?*/}
        {mode === 'create' && (
          <button
            className="creator-btn creator-btn-import"
            onClick={() => setShowImport(!showImport)}
          >
            {t('editor.magnet-creator.action.importConfig')}
          </button>
        )}
        {/* 缂傚倹鐗炵欢顐⑽熼垾宕囩闁挎稒纰嶅Ο澶岀矆閸濆嫷鍤ら柛鎴犲劋鐎垫粓鏌?*/}
        {mode === 'edit' && (
          <button
            className="creator-btn creator-btn-export"
            onClick={handleExport}
            disabled={!previewMagnet}
          >
            {t('editor.magnet-creator.action.exportConfig')}
          </button>
        )}
        <button className="creator-btn creator-btn-save" onClick={handleSave} disabled={!isValid}>
          {mode === 'edit' ? t('common.action.done') : t('common.action.create')}
        </button>
      </div>

      {/* 闁告ê妫楄ぐ鍓佹媼閺夎法绉块梻鍫涘灪閿?*/}
      {showHistory && mode === 'edit' && (
        <div className="creator-history-panel">
          <div className="creator-history-header">
            <h3>{t('editor.magnet-creator.history.title')}</h3>
          </div>
          <div className="creator-history-list">
            {history.length === 0 ? (
              <div className="creator-history-empty">{t('editor.magnet-creator.history.empty')}</div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="creator-history-item">
                  <div className="creator-history-item-info">
                    <div className="creator-history-item-desc">{t(item.description)}</div>
                    <div className="creator-history-item-time">
                      {new Date(item.timestamp).toLocaleString(locale, {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className="creator-history-item-actions">
                    <button
                      className="creator-history-btn creator-history-btn-apply"
                      onClick={() => handleApplyHistory(item)}
                      title={t('editor.magnet-creator.history.action.applyTitle')}
                    >
                      {t('common.action.apply')}
                    </button>
                    <button
                      className="creator-history-btn creator-history-btn-delete"
                      onClick={() => handleDeleteHistory(item.id)}
                      title={t('editor.magnet-creator.history.action.deleteTitle')}
                    >
                      閿?
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 閻庣數鍘ч崣鍡涙閵忊剝绶?- 濞寸姴鎳庡﹢顏堝礆濞戞绱︽俊顖椻偓宕囩闁哄嫬澧介敓?*/}
      {showImport && mode === 'create' && (
        <div className="creator-import-panel">
          <div className="creator-import-header">
            <h3>{t('editor.magnet-creator.import.title')}</h3>
            <button
              className="creator-import-close"
              onClick={() => {
                setShowImport(false);
                setImportJson('');
                setImportError('');
              }}
            >
              閿?
            </button>
          </div>
          <div className="creator-import-content">
            <div className="creator-import-file-select">
              <button className="creator-btn creator-btn-import" onClick={handleImportFromFile}>
                {t('editor.magnet-creator.import.action.chooseFile')}
              </button>
              <span className="creator-import-or">{t('editor.magnet-creator.import.orPaste')}</span>
            </div>
            <textarea
              className="creator-import-textarea"
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder={t('editor.magnet-creator.import.placeholder')}
              rows={15}
            />
            {importError && <div className="creator-import-error">{t(importError)}</div>}
            <div className="creator-import-hint">
              妫ｅ啯瀵?{t('editor.magnet-creator.import.hint.usageTitle')}
              <br />閿?{t('editor.magnet-creator.import.hint.usage1')}
              <br />閿?{t('editor.magnet-creator.import.hint.usage2')}
              <br />閿?{t('editor.magnet-creator.import.hint.usage3')}
              <br />
              <br />
              闁宠法濯撮敓?{t('editor.magnet-creator.import.hint.limitsTitle')}
              <br />閿?{t('editor.magnet-creator.import.hint.limit1')}
              <br />閿?{t('editor.magnet-creator.import.hint.limit2')}
              <br />閿?{t('editor.magnet-creator.import.hint.limit3')}
              <br />
              <br />
              妫ｅ啯鎲?{t('editor.magnet-creator.import.hint.howToTitle')}
              <br />閿?{t('editor.magnet-creator.import.hint.howToSee')}{' '}
              <code>apps/desktop/src/data/custom/exampleCustomMagnet.ts</code>
              <br />閿?{t('editor.magnet-creator.import.hint.howToDoc')}{' '}
              <code>mannual/Magnet/how-to-add-magnets.md</code>
            </div>
          </div>
          <div className="creator-import-actions">
            <button
              className="creator-btn creator-btn-cancel"
              onClick={() => {
                setShowImport(false);
                setImportJson('');
                setImportError('');
              }}
            >
              {t('common.action.cancel')}
            </button>
            <button
              className="creator-btn creator-btn-save"
              onClick={handleImport}
              disabled={!importJson.trim()}
            >
              {t('editor.magnet-creator.import.action.importAndEdit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
