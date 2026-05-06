use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const MATRIX_COLUMNS: f64 = 27.0;
const MATRIX_ROWS: f64 = 20.0;
const MATRIX_PIXEL_SIZE: f64 = 18.0;

const MIN_VISUAL_GAP_PX: f64 = 0.0;
const ITERATION_LIMIT: usize = 4;
const CONFLICT_OVERLAP_DEADZONE_PX: f64 = 0.0;
const EDGE_TOLERANCE_PX: f64 = 1.0;
const MAX_SEAM_SNAP_GAP_PX: f64 = 4.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetInsets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PixelPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetBoundsJoinEdges {
    #[serde(default)]
    pub left: bool,
    #[serde(default)]
    pub right: bool,
    #[serde(default)]
    pub top: bool,
    #[serde(default)]
    pub bottom: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorType {
    Single,
    Horizontal,
    Vertical,
    Rectangular,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PixelAnchorRole {
    Anchor,
    Boundary,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PixelAnchor {
    pub id: String,
    pub grid_x: f64,
    pub grid_y: f64,
    pub role: PixelAnchorRole,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MagnetBoundsReferenceSource {
    Slot,
    Span,
    Band,
    Viewport,
    Magnet,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MagnetBoundsReferenceEdge {
    Start,
    Center,
    End,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetBoundsReference {
    pub source: MagnetBoundsReferenceSource,
    pub edge: MagnetBoundsReferenceEdge,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magnet_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetBoundsAxis {
    pub start: MagnetBoundsReference,
    pub end: MagnetBoundsReference,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetBoundsSpec {
    pub horizontal: MagnetBoundsAxis,
    pub vertical: MagnetBoundsAxis,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetInsetConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetChromeConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inset: Option<MagnetInsetConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outset: Option<MagnetInsetConfig>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetGeometryMagnet {
    pub id: String,
    pub anchor_type: AnchorType,
    #[serde(default)]
    pub anchors: Vec<PixelAnchor>,
    pub bounds: MagnetBoundsSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chrome: Option<MagnetChromeConfig>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MagnetGeometryContext<'a> {
    pub magnets_by_id: Option<&'a HashMap<String, MagnetGeometryMagnet>>,
    pub viewport: Option<Viewport>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct AxisRange {
    start: f64,
    end: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum AxisName {
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct AnchorSpan {
    left_col: f64,
    right_col: f64,
    top_row: f64,
    bottom_row: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MagnetAdaptiveLayoutMode {
    Normal,
    Compact,
    Constrained,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetAdaptiveConflict {
    pub magnet_a: String,
    pub magnet_b: String,
    pub axis: MagnetAdaptiveConflictAxis,
    pub deficit_px: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MagnetAdaptiveConflictAxis {
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetJoinEdges {
    pub left: bool,
    pub right: bool,
    pub top: bool,
    pub bottom: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetAdaptiveDiagnostics {
    pub max_adjustment_px: f64,
    pub out_of_bounds_ids: Vec<String>,
    pub conflicts: Vec<MagnetAdaptiveConflict>,
    pub unresolved_conflicts: Vec<MagnetAdaptiveConflict>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetAdaptiveLayoutResult {
    pub mode: MagnetAdaptiveLayoutMode,
    pub layout_bounds_by_magnet_id: HashMap<String, MagnetBounds>,
    pub joins_by_magnet_id: HashMap<String, MagnetJoinEdges>,
    pub diagnostics: MagnetAdaptiveDiagnostics,
}

fn coordinate_key(grid_x: f64, grid_y: f64) -> String {
    format!("{grid_x},{grid_y}")
}

fn normalize_inset_value(value: Option<f64>) -> f64 {
    match value {
        Some(value) if value.is_finite() => value.max(0.0),
        _ => 0.0,
    }
}

pub fn resolve_magnet_insets(config: Option<&MagnetInsetConfig>) -> MagnetInsets {
    MagnetInsets {
        top: normalize_inset_value(config.and_then(|config| config.top)),
        right: normalize_inset_value(config.and_then(|config| config.right)),
        bottom: normalize_inset_value(config.and_then(|config| config.bottom)),
        left: normalize_inset_value(config.and_then(|config| config.left)),
    }
}

pub fn collapse_magnet_insets_for_join_edges(
    insets: MagnetInsets,
    join_edges: Option<MagnetBoundsJoinEdges>,
) -> MagnetInsets {
    let join_edges = join_edges.unwrap_or_default();
    MagnetInsets {
        top: if join_edges.top { 0.0 } else { insets.top },
        right: if join_edges.right { 0.0 } else { insets.right },
        bottom: if join_edges.bottom {
            0.0
        } else {
            insets.bottom
        },
        left: if join_edges.left { 0.0 } else { insets.left },
    }
}

fn resolve_edge_value(range: AxisRange, edge: MagnetBoundsReferenceEdge) -> f64 {
    match edge {
        MagnetBoundsReferenceEdge::Start => range.start,
        MagnetBoundsReferenceEdge::End => range.end,
        MagnetBoundsReferenceEdge::Center => range.start + (range.end - range.start) / 2.0,
    }
}

fn resolve_anchor_span(magnet: &MagnetGeometryMagnet) -> Option<AnchorSpan> {
    if magnet.anchors.is_empty() {
        return None;
    }

    Some(AnchorSpan {
        left_col: magnet
            .anchors
            .iter()
            .map(|anchor| anchor.grid_x)
            .fold(f64::INFINITY, f64::min),
        right_col: magnet
            .anchors
            .iter()
            .map(|anchor| anchor.grid_x)
            .fold(f64::NEG_INFINITY, f64::max),
        top_row: magnet
            .anchors
            .iter()
            .map(|anchor| anchor.grid_y)
            .fold(f64::INFINITY, f64::min),
        bottom_row: magnet
            .anchors
            .iter()
            .map(|anchor| anchor.grid_y)
            .fold(f64::NEG_INFINITY, f64::max),
    })
}

fn resolve_anchor_band_range(
    axis: AxisName,
    grid_x: f64,
    grid_y: f64,
    pixel_positions: &HashMap<String, PixelPosition>,
) -> Option<AxisRange> {
    let current = pixel_positions.get(&coordinate_key(grid_x, grid_y))?;

    match axis {
        AxisName::Horizontal => {
            let next = if grid_x >= MATRIX_COLUMNS - 1.0 {
                None
            } else {
                pixel_positions.get(&coordinate_key(grid_x + 1.0, grid_y))
            };

            Some(AxisRange {
                start: current.x,
                end: next
                    .map(|position| position.x)
                    .unwrap_or(current.x + MATRIX_PIXEL_SIZE),
            })
        }
        AxisName::Vertical => {
            let next = if grid_y >= MATRIX_ROWS - 1.0 {
                None
            } else {
                pixel_positions.get(&coordinate_key(grid_x, grid_y + 1.0))
            };

            Some(AxisRange {
                start: current.y,
                end: next
                    .map(|position| position.y)
                    .unwrap_or(current.y + MATRIX_PIXEL_SIZE),
            })
        }
    }
}

fn resolve_slot_range(
    axis: AxisName,
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
) -> Option<AxisRange> {
    let anchor = magnet.anchors.first()?;
    resolve_anchor_band_range(axis, anchor.grid_x, anchor.grid_y, pixel_positions)
}

fn resolve_band_range(
    axis: AxisName,
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
) -> Option<AxisRange> {
    let span = resolve_anchor_span(magnet)?;

    match axis {
        AxisName::Horizontal => {
            let start =
                resolve_anchor_band_range(axis, span.left_col, span.top_row, pixel_positions)?
                    .start;
            let end =
                resolve_anchor_band_range(axis, span.right_col, span.top_row, pixel_positions)?.end;
            Some(AxisRange { start, end })
        }
        AxisName::Vertical => {
            let start =
                resolve_anchor_band_range(axis, span.left_col, span.top_row, pixel_positions)?
                    .start;
            let end =
                resolve_anchor_band_range(axis, span.left_col, span.bottom_row, pixel_positions)?
                    .end;
            Some(AxisRange { start, end })
        }
    }
}

fn resolve_span_range(
    axis: AxisName,
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
) -> Option<AxisRange> {
    let span = resolve_anchor_span(magnet)?;

    match axis {
        AxisName::Horizontal => {
            let left = pixel_positions.get(&coordinate_key(span.left_col, span.top_row))?;
            let right = pixel_positions.get(&coordinate_key(span.right_col, span.top_row))?;
            Some(AxisRange {
                start: left.x,
                end: right.x + MATRIX_PIXEL_SIZE,
            })
        }
        AxisName::Vertical => {
            let top = pixel_positions.get(&coordinate_key(span.left_col, span.top_row))?;
            let bottom = pixel_positions.get(&coordinate_key(span.left_col, span.bottom_row))?;
            Some(AxisRange {
                start: top.y,
                end: bottom.y + MATRIX_PIXEL_SIZE,
            })
        }
    }
}

fn resolve_viewport_range(axis: AxisName, viewport: Option<Viewport>) -> Option<AxisRange> {
    let viewport = viewport?;
    match axis {
        AxisName::Horizontal => Some(AxisRange {
            start: 0.0,
            end: viewport.width,
        }),
        AxisName::Vertical => Some(AxisRange {
            start: 0.0,
            end: viewport.height,
        }),
    }
}

fn resolve_range_by_source(
    axis: AxisName,
    reference: &MagnetBoundsReference,
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
    context: &MagnetGeometryContext<'_>,
    cache: &mut HashMap<String, Option<MagnetBounds>>,
    resolving_ids: &mut HashSet<String>,
) -> Option<AxisRange> {
    match reference.source {
        MagnetBoundsReferenceSource::Slot => resolve_slot_range(axis, magnet, pixel_positions),
        MagnetBoundsReferenceSource::Span => resolve_span_range(axis, magnet, pixel_positions),
        MagnetBoundsReferenceSource::Band => resolve_band_range(axis, magnet, pixel_positions),
        MagnetBoundsReferenceSource::Viewport => resolve_viewport_range(axis, context.viewport),
        MagnetBoundsReferenceSource::Magnet => {
            let magnet_id = reference.magnet_id.as_deref()?;
            let referenced_bounds = resolve_referenced_structural_bounds(
                magnet_id,
                pixel_positions,
                context,
                cache,
                resolving_ids,
            )?;
            match axis {
                AxisName::Horizontal => Some(AxisRange {
                    start: referenced_bounds.x,
                    end: referenced_bounds.x + referenced_bounds.width,
                }),
                AxisName::Vertical => Some(AxisRange {
                    start: referenced_bounds.y,
                    end: referenced_bounds.y + referenced_bounds.height,
                }),
            }
        }
    }
}

fn resolve_reference_value(
    axis: AxisName,
    reference: &MagnetBoundsReference,
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
    context: &MagnetGeometryContext<'_>,
    cache: &mut HashMap<String, Option<MagnetBounds>>,
    resolving_ids: &mut HashSet<String>,
) -> Option<f64> {
    let range = resolve_range_by_source(
        axis,
        reference,
        magnet,
        pixel_positions,
        context,
        cache,
        resolving_ids,
    )?;
    Some(resolve_edge_value(range, reference.edge) + reference.offset.unwrap_or(0.0))
}

fn resolve_axis_span(
    axis: AxisName,
    bounds: &MagnetBoundsAxis,
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
    context: &MagnetGeometryContext<'_>,
    cache: &mut HashMap<String, Option<MagnetBounds>>,
    resolving_ids: &mut HashSet<String>,
) -> Option<AxisRange> {
    let start = resolve_reference_value(
        axis,
        &bounds.start,
        magnet,
        pixel_positions,
        context,
        cache,
        resolving_ids,
    )?;
    let end = resolve_reference_value(
        axis,
        &bounds.end,
        magnet,
        pixel_positions,
        context,
        cache,
        resolving_ids,
    )?;

    if !start.is_finite() || !end.is_finite() || end <= start {
        return None;
    }

    Some(AxisRange { start, end })
}

fn create_bounds_from_axis_ranges(
    horizontal: Option<AxisRange>,
    vertical: Option<AxisRange>,
) -> Option<MagnetBounds> {
    let horizontal = horizontal?;
    let vertical = vertical?;

    Some(MagnetBounds {
        x: horizontal.start,
        y: vertical.start,
        width: horizontal.end - horizontal.start,
        height: vertical.end - vertical.start,
    })
}

fn compute_magnet_bounds_internal(
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
    context: &MagnetGeometryContext<'_>,
    cache: &mut HashMap<String, Option<MagnetBounds>>,
    resolving_ids: &mut HashSet<String>,
) -> Option<MagnetBounds> {
    if let Some(cached) = cache.get(&magnet.id) {
        return *cached;
    }

    if resolving_ids.contains(&magnet.id) {
        return None;
    }

    resolving_ids.insert(magnet.id.clone());

    let horizontal = resolve_axis_span(
        AxisName::Horizontal,
        &magnet.bounds.horizontal,
        magnet,
        pixel_positions,
        context,
        cache,
        resolving_ids,
    );
    let vertical = resolve_axis_span(
        AxisName::Vertical,
        &magnet.bounds.vertical,
        magnet,
        pixel_positions,
        context,
        cache,
        resolving_ids,
    );
    let bounds = create_bounds_from_axis_ranges(horizontal, vertical);

    resolving_ids.remove(&magnet.id);
    cache.insert(magnet.id.clone(), bounds);

    bounds
}

fn resolve_referenced_structural_bounds(
    magnet_id: &str,
    pixel_positions: &HashMap<String, PixelPosition>,
    context: &MagnetGeometryContext<'_>,
    cache: &mut HashMap<String, Option<MagnetBounds>>,
    resolving_ids: &mut HashSet<String>,
) -> Option<MagnetBounds> {
    if let Some(cached) = cache.get(magnet_id) {
        return *cached;
    }

    let referenced_magnet = context.magnets_by_id?.get(magnet_id)?;
    compute_magnet_bounds_internal(
        referenced_magnet,
        pixel_positions,
        context,
        cache,
        resolving_ids,
    )
}

pub fn compute_magnet_bounds(
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
    context: MagnetGeometryContext<'_>,
) -> Option<MagnetBounds> {
    let mut cache = HashMap::new();
    let mut resolving_ids = HashSet::new();
    compute_magnet_bounds_internal(
        magnet,
        pixel_positions,
        &context,
        &mut cache,
        &mut resolving_ids,
    )
}

pub fn compute_magnet_visual_bounds(
    magnet: &MagnetGeometryMagnet,
    pixel_positions: &HashMap<String, PixelPosition>,
    context: MagnetGeometryContext<'_>,
    join_edges: Option<MagnetBoundsJoinEdges>,
) -> Option<MagnetBounds> {
    let layout_bounds = compute_magnet_bounds(magnet, pixel_positions, context);
    compute_chrome_bounds_from_layout_bounds(layout_bounds, magnet.chrome.as_ref(), join_edges)
}

fn has_inset_values(insets: MagnetInsets) -> bool {
    insets.top > 0.0 || insets.right > 0.0 || insets.bottom > 0.0 || insets.left > 0.0
}

fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

pub fn align_magnet_bounds(bounds: MagnetBounds) -> MagnetBounds {
    let left = js_round(bounds.x);
    let top = js_round(bounds.y);
    let right = js_round(bounds.x + bounds.width);
    let bottom = js_round(bounds.y + bounds.height);

    MagnetBounds {
        x: left,
        y: top,
        width: (right - left).max(1.0),
        height: (bottom - top).max(1.0),
    }
}

fn adjust_magnet_bounds(
    bounds: MagnetBounds,
    inset: MagnetInsets,
    outset: MagnetInsets,
) -> MagnetBounds {
    align_magnet_bounds(MagnetBounds {
        x: bounds.x + inset.left - outset.left,
        y: bounds.y + inset.top - outset.top,
        width: (bounds.width - inset.left - inset.right + outset.left + outset.right).max(1.0),
        height: (bounds.height - inset.top - inset.bottom + outset.top + outset.bottom).max(1.0),
    })
}

pub fn create_zero_insets() -> MagnetInsets {
    MagnetInsets::default()
}

pub fn inset_magnet_bounds(bounds: MagnetBounds, insets: MagnetInsets) -> MagnetBounds {
    adjust_magnet_bounds(bounds, insets, create_zero_insets())
}

pub fn outset_magnet_bounds(bounds: MagnetBounds, outsets: MagnetInsets) -> MagnetBounds {
    adjust_magnet_bounds(bounds, create_zero_insets(), outsets)
}

pub fn compute_content_bounds_from_layout_bounds(
    bounds: Option<MagnetBounds>,
    chrome: Option<&MagnetChromeConfig>,
) -> Option<MagnetBounds> {
    let bounds = bounds?;
    let inset = resolve_magnet_insets(chrome.and_then(|chrome| chrome.inset.as_ref()));
    if !has_inset_values(inset) {
        return Some(bounds);
    }

    Some(adjust_magnet_bounds(bounds, inset, create_zero_insets()))
}

pub fn compute_chrome_bounds_from_layout_bounds(
    bounds: Option<MagnetBounds>,
    chrome: Option<&MagnetChromeConfig>,
    join_edges: Option<MagnetBoundsJoinEdges>,
) -> Option<MagnetBounds> {
    let bounds = bounds?;
    let outset = collapse_magnet_insets_for_join_edges(
        resolve_magnet_insets(chrome.and_then(|chrome| chrome.outset.as_ref())),
        join_edges,
    );

    if !has_inset_values(outset) {
        return Some(bounds);
    }

    Some(adjust_magnet_bounds(bounds, create_zero_insets(), outset))
}

pub fn apply_chrome_to_magnet_bounds(
    bounds: Option<MagnetBounds>,
    chrome: Option<&MagnetChromeConfig>,
) -> Option<MagnetBounds> {
    compute_chrome_bounds_from_layout_bounds(bounds, chrome, None)
}

pub fn expand_magnet_bounds_with_chrome_outset(
    bounds: Option<MagnetBounds>,
    outset_config: Option<&MagnetInsetConfig>,
) -> Option<MagnetBounds> {
    let bounds = bounds?;
    let outsets = resolve_magnet_insets(outset_config);
    if has_inset_values(outsets) {
        Some(outset_magnet_bounds(bounds, outsets))
    } else {
        Some(bounds)
    }
}

fn clone_bounds(bounds: &MagnetBounds) -> MagnetBounds {
    *bounds
}

fn to_magnet_bounds_map(magnets: &[MagnetGeometryMagnet]) -> HashMap<String, MagnetGeometryMagnet> {
    magnets
        .iter()
        .map(|magnet| (magnet.id.clone(), magnet.clone()))
        .collect()
}

fn get_horizontal_gap(first: MagnetBounds, second: MagnetBounds) -> f64 {
    (second.x - (first.x + first.width))
        .max(first.x - (second.x + second.width))
        .max(0.0)
}

fn get_vertical_gap(first: MagnetBounds, second: MagnetBounds) -> f64 {
    (second.y - (first.y + first.height))
        .max(first.y - (second.y + second.height))
        .max(0.0)
}

fn get_overlap(first_start: f64, first_size: f64, second_start: f64, second_size: f64) -> f64 {
    (first_start + first_size).min(second_start + second_size) - first_start.max(second_start)
}

fn collect_horizontally_aligned_ids(
    reference_id: &str,
    reference_bounds: MagnetBounds,
    bounds_by_magnet_id: &HashMap<String, MagnetBounds>,
    magnets_by_id: &HashMap<String, MagnetGeometryMagnet>,
    magnet_order: &[String],
) -> Vec<String> {
    let Some(reference_magnet) = magnets_by_id.get(reference_id) else {
        return vec![reference_id.to_string()];
    };
    if reference_magnet.anchor_type != AnchorType::Rectangular {
        return vec![reference_id.to_string()];
    }

    let mut group = Vec::new();
    for magnet_id in magnet_order {
        let Some(bounds) = bounds_by_magnet_id.get(magnet_id) else {
            continue;
        };
        let Some(magnet) = magnets_by_id.get(magnet_id) else {
            continue;
        };
        if magnet.anchor_type != reference_magnet.anchor_type {
            continue;
        }
        if (bounds.x - reference_bounds.x).abs() > EDGE_TOLERANCE_PX {
            continue;
        }
        if (bounds.width - reference_bounds.width).abs() > EDGE_TOLERANCE_PX {
            continue;
        }
        group.push(magnet_id.clone());
    }

    if group.is_empty() {
        vec![reference_id.to_string()]
    } else {
        group
    }
}

fn collect_vertically_aligned_ids(
    reference_id: &str,
    reference_bounds: MagnetBounds,
    bounds_by_magnet_id: &HashMap<String, MagnetBounds>,
    magnets_by_id: &HashMap<String, MagnetGeometryMagnet>,
    magnet_order: &[String],
) -> Vec<String> {
    let Some(reference_magnet) = magnets_by_id.get(reference_id) else {
        return vec![reference_id.to_string()];
    };
    if reference_magnet.anchor_type != AnchorType::Rectangular {
        return vec![reference_id.to_string()];
    }

    let mut group = Vec::new();
    for magnet_id in magnet_order {
        let Some(bounds) = bounds_by_magnet_id.get(magnet_id) else {
            continue;
        };
        let Some(magnet) = magnets_by_id.get(magnet_id) else {
            continue;
        };
        if magnet.anchor_type != reference_magnet.anchor_type {
            continue;
        }
        if (bounds.y - reference_bounds.y).abs() > EDGE_TOLERANCE_PX {
            continue;
        }
        if (bounds.height - reference_bounds.height).abs() > EDGE_TOLERANCE_PX {
            continue;
        }
        group.push(magnet_id.clone());
    }

    if group.is_empty() {
        vec![reference_id.to_string()]
    } else {
        group
    }
}

fn shift_vertically(
    top_id: &str,
    bottom_id: &str,
    bounds_by_magnet_id: &mut HashMap<String, MagnetBounds>,
    viewport_height: f64,
    deficit_px: f64,
) -> f64 {
    if top_id == bottom_id {
        return 0.0;
    }

    let (top_y, bottom_y, bottom_height) = {
        let Some(top_bounds) = bounds_by_magnet_id.get(top_id) else {
            return 0.0;
        };
        let Some(bottom_bounds) = bounds_by_magnet_id.get(bottom_id) else {
            return 0.0;
        };
        (top_bounds.y, bottom_bounds.y, bottom_bounds.height)
    };

    let available_up = top_y.max(0.0);
    let available_down = (viewport_height - (bottom_y + bottom_height)).max(0.0);
    let desired_up = (deficit_px / 2.0).ceil();
    let desired_down = (deficit_px / 2.0).floor();
    let applied_up = desired_up.min(available_up);
    let applied_down = desired_down.min(available_down);
    let mut resolved = applied_up + applied_down;

    if resolved < deficit_px {
        let extra_down = (deficit_px - resolved).min((available_down - applied_down).max(0.0));
        resolved += extra_down;
        if let Some(bottom_bounds) = bounds_by_magnet_id.get_mut(bottom_id) {
            bottom_bounds.y += extra_down;
        }
    }

    if resolved < deficit_px {
        let extra_up = (deficit_px - resolved).min((available_up - applied_up).max(0.0));
        resolved += extra_up;
        if let Some(top_bounds) = bounds_by_magnet_id.get_mut(top_id) {
            top_bounds.y -= extra_up;
        }
    }

    if applied_up > 0.0 {
        if let Some(top_bounds) = bounds_by_magnet_id.get_mut(top_id) {
            top_bounds.y -= applied_up;
        }
    }

    if applied_down > 0.0 {
        if let Some(bottom_bounds) = bounds_by_magnet_id.get_mut(bottom_id) {
            bottom_bounds.y += applied_down;
        }
    }

    resolved
}

fn min_for_ids<F>(
    ids: &[String],
    bounds_by_magnet_id: &HashMap<String, MagnetBounds>,
    mut value_for: F,
) -> f64
where
    F: FnMut(MagnetBounds) -> f64,
{
    ids.iter()
        .filter_map(|id| bounds_by_magnet_id.get(id).copied())
        .map(|bounds| value_for(bounds))
        .fold(f64::INFINITY, f64::min)
}

fn shift_horizontally(
    left_ids: &[String],
    right_ids: &[String],
    bounds_by_magnet_id: &mut HashMap<String, MagnetBounds>,
    viewport_width: f64,
    deficit_px: f64,
) -> f64 {
    let available_left = min_for_ids(left_ids, bounds_by_magnet_id, |bounds| bounds.x.max(0.0));
    let available_right = min_for_ids(right_ids, bounds_by_magnet_id, |bounds| {
        (viewport_width - (bounds.x + bounds.width)).max(0.0)
    });
    let desired_left = (deficit_px / 2.0).ceil();
    let desired_right = (deficit_px / 2.0).floor();
    let mut shift_left = desired_left.min(available_left);
    let mut shift_right = desired_right.min(available_right);
    let mut resolved = shift_left + shift_right;

    if resolved < deficit_px {
        let extra_right = (deficit_px - resolved).min((available_right - shift_right).max(0.0));
        resolved += extra_right;
        shift_right += extra_right;
    }

    if resolved < deficit_px {
        let extra_left = (deficit_px - resolved).min((available_left - shift_left).max(0.0));
        resolved += extra_left;
        shift_left += extra_left;
    }

    if shift_left > 0.0 {
        for id in left_ids {
            if let Some(bounds) = bounds_by_magnet_id.get_mut(id) {
                bounds.x -= shift_left;
            }
        }
    }

    if shift_right > 0.0 {
        for id in right_ids {
            if let Some(bounds) = bounds_by_magnet_id.get_mut(id) {
                bounds.x += shift_right;
            }
        }
    }

    resolved
}

fn pull_horizontally(
    left_ids: &[String],
    right_ids: &[String],
    bounds_by_magnet_id: &mut HashMap<String, MagnetBounds>,
    viewport_width: f64,
    gap_px: f64,
) -> f64 {
    let left_viewport_slack =
        min_for_ids(left_ids, bounds_by_magnet_id, |bounds| bounds.x.max(0.0));
    let right_viewport_slack = min_for_ids(right_ids, bounds_by_magnet_id, |bounds| {
        (viewport_width - (bounds.x + bounds.width)).max(0.0)
    });
    let left_move_capacity = min_for_ids(left_ids, bounds_by_magnet_id, |bounds| {
        (viewport_width - (bounds.x + bounds.width)).max(0.0)
    });
    let right_move_capacity =
        min_for_ids(right_ids, bounds_by_magnet_id, |bounds| bounds.x.max(0.0));
    let mut remaining = gap_px.ceil().max(0.0);
    let pull_right_group_first = left_viewport_slack <= right_viewport_slack;
    let (move_left_group_right, move_right_group_left) = if pull_right_group_first {
        let move_right_group_left = remaining.min(right_move_capacity);
        remaining -= move_right_group_left;
        let move_left_group_right = remaining.min(left_move_capacity);
        (move_left_group_right, move_right_group_left)
    } else {
        let move_left_group_right = remaining.min(left_move_capacity);
        remaining -= move_left_group_right;
        let move_right_group_left = remaining.min(right_move_capacity);
        (move_left_group_right, move_right_group_left)
    };

    if move_left_group_right > 0.0 {
        for id in left_ids {
            if let Some(bounds) = bounds_by_magnet_id.get_mut(id) {
                bounds.x += move_left_group_right;
            }
        }
    }

    if move_right_group_left > 0.0 {
        for id in right_ids {
            if let Some(bounds) = bounds_by_magnet_id.get_mut(id) {
                bounds.x -= move_right_group_left;
            }
        }
    }

    move_left_group_right + move_right_group_left
}

fn pull_vertically(
    top_ids: &[String],
    bottom_ids: &[String],
    bounds_by_magnet_id: &mut HashMap<String, MagnetBounds>,
    viewport_height: f64,
    gap_px: f64,
) -> f64 {
    let top_viewport_slack = min_for_ids(top_ids, bounds_by_magnet_id, |bounds| bounds.y.max(0.0));
    let bottom_viewport_slack = min_for_ids(bottom_ids, bounds_by_magnet_id, |bounds| {
        (viewport_height - (bounds.y + bounds.height)).max(0.0)
    });
    let top_move_capacity = min_for_ids(top_ids, bounds_by_magnet_id, |bounds| {
        (viewport_height - (bounds.y + bounds.height)).max(0.0)
    });
    let bottom_move_capacity =
        min_for_ids(bottom_ids, bounds_by_magnet_id, |bounds| bounds.y.max(0.0));
    let mut remaining = gap_px.ceil().max(0.0);
    let pull_bottom_group_first = top_viewport_slack <= bottom_viewport_slack;
    let (move_top_group_down, move_bottom_group_up) = if pull_bottom_group_first {
        let move_bottom_group_up = remaining.min(bottom_move_capacity);
        remaining -= move_bottom_group_up;
        let move_top_group_down = remaining.min(top_move_capacity);
        (move_top_group_down, move_bottom_group_up)
    } else {
        let move_top_group_down = remaining.min(top_move_capacity);
        remaining -= move_top_group_down;
        let move_bottom_group_up = remaining.min(bottom_move_capacity);
        (move_top_group_down, move_bottom_group_up)
    };

    if move_top_group_down > 0.0 {
        for id in top_ids {
            if let Some(bounds) = bounds_by_magnet_id.get_mut(id) {
                bounds.y += move_top_group_down;
            }
        }
    }

    if move_bottom_group_up > 0.0 {
        for id in bottom_ids {
            if let Some(bounds) = bounds_by_magnet_id.get_mut(id) {
                bounds.y -= move_bottom_group_up;
            }
        }
    }

    move_top_group_down + move_bottom_group_up
}

fn detect_pair_conflict(
    first_id: &str,
    second_id: &str,
    first_bounds: MagnetBounds,
    second_bounds: MagnetBounds,
) -> Option<MagnetAdaptiveConflict> {
    let raw_x_overlap = get_overlap(
        first_bounds.x,
        first_bounds.width,
        second_bounds.x,
        second_bounds.width,
    );
    let raw_y_overlap = get_overlap(
        first_bounds.y,
        first_bounds.height,
        second_bounds.y,
        second_bounds.height,
    );
    let x_overlap = if raw_x_overlap > CONFLICT_OVERLAP_DEADZONE_PX {
        raw_x_overlap
    } else {
        0.0
    };
    let y_overlap = if raw_y_overlap > CONFLICT_OVERLAP_DEADZONE_PX {
        raw_y_overlap
    } else {
        0.0
    };
    let x_gap = get_horizontal_gap(first_bounds, second_bounds);
    let y_gap = get_vertical_gap(first_bounds, second_bounds);

    if x_overlap > 0.0 && y_overlap > 0.0 {
        if x_overlap <= y_overlap {
            return Some(MagnetAdaptiveConflict {
                magnet_a: first_id.to_string(),
                magnet_b: second_id.to_string(),
                axis: MagnetAdaptiveConflictAxis::Horizontal,
                deficit_px: (x_overlap + MIN_VISUAL_GAP_PX).ceil(),
            });
        }

        return Some(MagnetAdaptiveConflict {
            magnet_a: first_id.to_string(),
            magnet_b: second_id.to_string(),
            axis: MagnetAdaptiveConflictAxis::Vertical,
            deficit_px: (y_overlap + MIN_VISUAL_GAP_PX).ceil(),
        });
    }

    if x_overlap > 0.0 && y_gap < MIN_VISUAL_GAP_PX {
        return Some(MagnetAdaptiveConflict {
            magnet_a: first_id.to_string(),
            magnet_b: second_id.to_string(),
            axis: MagnetAdaptiveConflictAxis::Vertical,
            deficit_px: (MIN_VISUAL_GAP_PX - y_gap).ceil(),
        });
    }

    if y_overlap > 0.0 && x_gap < MIN_VISUAL_GAP_PX {
        return Some(MagnetAdaptiveConflict {
            magnet_a: first_id.to_string(),
            magnet_b: second_id.to_string(),
            axis: MagnetAdaptiveConflictAxis::Horizontal,
            deficit_px: (MIN_VISUAL_GAP_PX - x_gap).ceil(),
        });
    }

    None
}

fn spans_overlap(first_start: f64, first_end: f64, second_start: f64, second_end: f64) -> bool {
    first_end.min(second_end) - first_start.max(second_start) > 0.0
}

fn is_rectangular_grid_neighbor(
    first_magnet: &MagnetGeometryMagnet,
    second_magnet: &MagnetGeometryMagnet,
    axis: MagnetAdaptiveConflictAxis,
) -> bool {
    if first_magnet.anchor_type != AnchorType::Rectangular
        || second_magnet.anchor_type != AnchorType::Rectangular
    {
        return false;
    }

    let Some(first_span) = resolve_anchor_span(first_magnet) else {
        return false;
    };
    let Some(second_span) = resolve_anchor_span(second_magnet) else {
        return false;
    };

    match axis {
        MagnetAdaptiveConflictAxis::Horizontal => {
            let adjacent = first_span.right_col + 1.0 == second_span.left_col
                || second_span.right_col + 1.0 == first_span.left_col;
            adjacent
                && spans_overlap(
                    first_span.top_row,
                    first_span.bottom_row + 1.0,
                    second_span.top_row,
                    second_span.bottom_row + 1.0,
                )
        }
        MagnetAdaptiveConflictAxis::Vertical => {
            let adjacent = first_span.bottom_row + 1.0 == second_span.top_row
                || second_span.bottom_row + 1.0 == first_span.top_row;
            adjacent
                && spans_overlap(
                    first_span.left_col,
                    first_span.right_col + 1.0,
                    second_span.left_col,
                    second_span.right_col + 1.0,
                )
        }
    }
}

fn snap_rectangular_neighbor_seams(
    bounds_by_magnet_id: &mut HashMap<String, MagnetBounds>,
    magnets_by_id: &HashMap<String, MagnetGeometryMagnet>,
    magnet_order: &[String],
    viewport: Viewport,
) -> f64 {
    let mut max_snap_px: f64 = 0.0;

    for index in 0..magnet_order.len() {
        let first_id = &magnet_order[index];
        let Some(first_magnet) = magnets_by_id.get(first_id) else {
            continue;
        };

        for next_index in (index + 1)..magnet_order.len() {
            let second_id = &magnet_order[next_index];
            let Some(second_magnet) = magnets_by_id.get(second_id) else {
                continue;
            };
            let Some(first_bounds) = bounds_by_magnet_id.get(first_id).copied() else {
                continue;
            };
            let Some(second_bounds) = bounds_by_magnet_id.get(second_id).copied() else {
                continue;
            };

            let y_overlap = get_overlap(
                first_bounds.y,
                first_bounds.height,
                second_bounds.y,
                second_bounds.height,
            );
            if y_overlap > 0.0
                && is_rectangular_grid_neighbor(
                    first_magnet,
                    second_magnet,
                    MagnetAdaptiveConflictAxis::Horizontal,
                )
            {
                let (left_id, right_id) = if first_bounds.x <= second_bounds.x {
                    (first_id, second_id)
                } else {
                    (second_id, first_id)
                };
                let Some(left_bounds) = bounds_by_magnet_id.get(left_id).copied() else {
                    continue;
                };
                let Some(right_bounds) = bounds_by_magnet_id.get(right_id).copied() else {
                    continue;
                };
                let gap = right_bounds.x - (left_bounds.x + left_bounds.width);
                if gap > EDGE_TOLERANCE_PX && gap <= MAX_SEAM_SNAP_GAP_PX {
                    let left_ids = collect_horizontally_aligned_ids(
                        left_id,
                        left_bounds,
                        bounds_by_magnet_id,
                        magnets_by_id,
                        magnet_order,
                    );
                    let right_ids = collect_horizontally_aligned_ids(
                        right_id,
                        right_bounds,
                        bounds_by_magnet_id,
                        magnets_by_id,
                        magnet_order,
                    );
                    let snap_px = pull_horizontally(
                        &left_ids,
                        &right_ids,
                        bounds_by_magnet_id,
                        viewport.width,
                        gap,
                    );
                    max_snap_px = max_snap_px.max(snap_px);
                }
            }

            let x_overlap = get_overlap(
                first_bounds.x,
                first_bounds.width,
                second_bounds.x,
                second_bounds.width,
            );
            if x_overlap > 0.0
                && is_rectangular_grid_neighbor(
                    first_magnet,
                    second_magnet,
                    MagnetAdaptiveConflictAxis::Vertical,
                )
            {
                let (top_id, bottom_id) = if first_bounds.y <= second_bounds.y {
                    (first_id, second_id)
                } else {
                    (second_id, first_id)
                };
                let Some(top_bounds) = bounds_by_magnet_id.get(top_id).copied() else {
                    continue;
                };
                let Some(bottom_bounds) = bounds_by_magnet_id.get(bottom_id).copied() else {
                    continue;
                };
                let gap = bottom_bounds.y - (top_bounds.y + top_bounds.height);
                if gap > EDGE_TOLERANCE_PX && gap <= MAX_SEAM_SNAP_GAP_PX {
                    let top_ids = collect_vertically_aligned_ids(
                        top_id,
                        top_bounds,
                        bounds_by_magnet_id,
                        magnets_by_id,
                        magnet_order,
                    );
                    let bottom_ids = collect_vertically_aligned_ids(
                        bottom_id,
                        bottom_bounds,
                        bounds_by_magnet_id,
                        magnets_by_id,
                        magnet_order,
                    );
                    let snap_px = pull_vertically(
                        &top_ids,
                        &bottom_ids,
                        bounds_by_magnet_id,
                        viewport.height,
                        gap,
                    );
                    max_snap_px = max_snap_px.max(snap_px);
                }
            }
        }
    }

    max_snap_px
}

#[derive(Clone, Copy, Debug)]
struct Segment {
    start: f64,
    end: f64,
}

#[derive(Clone, Debug, Default)]
struct SegmentMap {
    left: Vec<Segment>,
    right: Vec<Segment>,
    top: Vec<Segment>,
    bottom: Vec<Segment>,
}

fn push_segment(segments: &mut Vec<Segment>, start: f64, end: f64) {
    if !start.is_finite() || !end.is_finite() {
        return;
    }
    if end - start <= 0.0 {
        return;
    }
    segments.push(Segment { start, end });
}

fn merge_segments(segments: &[Segment]) -> Vec<Segment> {
    if segments.is_empty() {
        return Vec::new();
    }

    let mut sorted = segments.to_vec();
    sorted.sort_by(|left, right| {
        left.start
            .partial_cmp(&right.start)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                left.end
                    .partial_cmp(&right.end)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    let mut merged = vec![sorted[0]];
    for segment in sorted.into_iter().skip(1) {
        let last = merged.last_mut().expect("merged segment exists");
        if segment.start <= last.end {
            last.end = last.end.max(segment.end);
        } else {
            merged.push(segment);
        }
    }
    merged
}

fn coverage_of_segments(segments: &[Segment]) -> f64 {
    merge_segments(segments)
        .iter()
        .map(|segment| segment.end - segment.start)
        .sum()
}

fn is_fully_covered(segments: &[Segment], length: f64) -> bool {
    !segments.is_empty() && coverage_of_segments(segments) >= length.max(0.0)
}

fn detect_magnet_joins(
    bounds_by_magnet_id: &HashMap<String, MagnetBounds>,
    magnet_order: &[String],
) -> HashMap<String, MagnetJoinEdges> {
    let mut joins_by_magnet_id: HashMap<String, MagnetJoinEdges> = magnet_order
        .iter()
        .filter(|magnet_id| bounds_by_magnet_id.contains_key(*magnet_id))
        .map(|magnet_id| (magnet_id.clone(), MagnetJoinEdges::default()))
        .collect();
    let mut segments_by_magnet_id: HashMap<String, SegmentMap> = magnet_order
        .iter()
        .filter(|magnet_id| bounds_by_magnet_id.contains_key(*magnet_id))
        .map(|magnet_id| (magnet_id.clone(), SegmentMap::default()))
        .collect();

    for index in 0..magnet_order.len() {
        let first_id = &magnet_order[index];
        let Some(first_bounds) = bounds_by_magnet_id.get(first_id).copied() else {
            continue;
        };
        for next_index in (index + 1)..magnet_order.len() {
            let second_id = &magnet_order[next_index];
            let Some(second_bounds) = bounds_by_magnet_id.get(second_id).copied() else {
                continue;
            };

            let x_overlap = get_overlap(
                first_bounds.x,
                first_bounds.width,
                second_bounds.x,
                second_bounds.width,
            );
            let y_overlap = get_overlap(
                first_bounds.y,
                first_bounds.height,
                second_bounds.y,
                second_bounds.height,
            );

            if y_overlap > 0.0 {
                let delta_right = first_bounds.x + first_bounds.width - second_bounds.x;
                let delta_left = second_bounds.x + second_bounds.width - first_bounds.x;
                let first_right_to_second_left =
                    delta_right >= 0.0 && delta_right <= EDGE_TOLERANCE_PX;
                let second_right_to_first_left =
                    delta_left >= 0.0 && delta_left <= EDGE_TOLERANCE_PX;

                if first_right_to_second_left {
                    let start = first_bounds.y.max(second_bounds.y);
                    let end = (first_bounds.y + first_bounds.height)
                        .min(second_bounds.y + second_bounds.height);
                    if let Some(segments) = segments_by_magnet_id.get_mut(first_id) {
                        push_segment(&mut segments.right, start, end);
                    }
                    if let Some(segments) = segments_by_magnet_id.get_mut(second_id) {
                        push_segment(&mut segments.left, start, end);
                    }
                }

                if second_right_to_first_left {
                    let start = first_bounds.y.max(second_bounds.y);
                    let end = (first_bounds.y + first_bounds.height)
                        .min(second_bounds.y + second_bounds.height);
                    if let Some(segments) = segments_by_magnet_id.get_mut(second_id) {
                        push_segment(&mut segments.right, start, end);
                    }
                    if let Some(segments) = segments_by_magnet_id.get_mut(first_id) {
                        push_segment(&mut segments.left, start, end);
                    }
                }
            }

            if x_overlap > 0.0 {
                let delta_bottom = first_bounds.y + first_bounds.height - second_bounds.y;
                let delta_top = second_bounds.y + second_bounds.height - first_bounds.y;
                let first_bottom_to_second_top =
                    delta_bottom >= 0.0 && delta_bottom <= EDGE_TOLERANCE_PX;
                let second_bottom_to_first_top = delta_top >= 0.0 && delta_top <= EDGE_TOLERANCE_PX;

                if first_bottom_to_second_top {
                    let start = first_bounds.x.max(second_bounds.x);
                    let end = (first_bounds.x + first_bounds.width)
                        .min(second_bounds.x + second_bounds.width);
                    if let Some(segments) = segments_by_magnet_id.get_mut(first_id) {
                        push_segment(&mut segments.bottom, start, end);
                    }
                    if let Some(segments) = segments_by_magnet_id.get_mut(second_id) {
                        push_segment(&mut segments.top, start, end);
                    }
                }

                if second_bottom_to_first_top {
                    let start = first_bounds.x.max(second_bounds.x);
                    let end = (first_bounds.x + first_bounds.width)
                        .min(second_bounds.x + second_bounds.width);
                    if let Some(segments) = segments_by_magnet_id.get_mut(second_id) {
                        push_segment(&mut segments.bottom, start, end);
                    }
                    if let Some(segments) = segments_by_magnet_id.get_mut(first_id) {
                        push_segment(&mut segments.top, start, end);
                    }
                }
            }
        }
    }

    for magnet_id in magnet_order {
        let Some(bounds) = bounds_by_magnet_id.get(magnet_id).copied() else {
            continue;
        };
        let Some(segments) = segments_by_magnet_id.get(magnet_id) else {
            continue;
        };
        if let Some(join_edges) = joins_by_magnet_id.get_mut(magnet_id) {
            join_edges.left = is_fully_covered(&segments.left, bounds.height);
            join_edges.right = is_fully_covered(&segments.right, bounds.height);
            join_edges.top = is_fully_covered(&segments.top, bounds.width);
            join_edges.bottom = is_fully_covered(&segments.bottom, bounds.width);
        }
    }

    joins_by_magnet_id
}

pub fn build_adaptive_magnet_layout(
    magnets: &[MagnetGeometryMagnet],
    pixel_positions: &HashMap<String, PixelPosition>,
    viewport: Viewport,
) -> MagnetAdaptiveLayoutResult {
    let magnets_by_id = to_magnet_bounds_map(magnets);
    let context = MagnetGeometryContext {
        magnets_by_id: Some(&magnets_by_id),
        viewport: Some(viewport),
    };
    let mut raw_bounds_entries: Vec<(String, MagnetBounds)> = Vec::new();
    for magnet in magnets {
        let Some(bounds) = compute_magnet_bounds(magnet, pixel_positions, context) else {
            continue;
        };
        raw_bounds_entries.push((magnet.id.clone(), align_magnet_bounds(bounds)));
    }

    let magnet_order: Vec<String> = raw_bounds_entries
        .iter()
        .map(|(magnet_id, _)| magnet_id.clone())
        .collect();
    let mut layout_bounds_by_magnet_id: HashMap<String, MagnetBounds> = raw_bounds_entries
        .iter()
        .map(|(magnet_id, bounds)| (magnet_id.clone(), clone_bounds(bounds)))
        .collect();

    let mut conflicts = Vec::new();
    let mut max_adjustment_px: f64 = 0.0;

    for _ in 0..ITERATION_LIMIT {
        let mut moved_in_iteration = false;

        for index in 0..raw_bounds_entries.len() {
            let first_id = &raw_bounds_entries[index].0;
            for next_index in (index + 1)..raw_bounds_entries.len() {
                let second_id = &raw_bounds_entries[next_index].0;
                let Some(first_bounds) = layout_bounds_by_magnet_id.get(first_id).copied() else {
                    continue;
                };
                let Some(second_bounds) = layout_bounds_by_magnet_id.get(second_id).copied() else {
                    continue;
                };
                let Some(conflict) =
                    detect_pair_conflict(first_id, second_id, first_bounds, second_bounds)
                else {
                    continue;
                };

                conflicts.push(conflict.clone());

                if conflict.axis == MagnetAdaptiveConflictAxis::Vertical {
                    let (top_id, bottom_id) = if first_bounds.y <= second_bounds.y {
                        (first_id, second_id)
                    } else {
                        (second_id, first_id)
                    };
                    let resolved_px = shift_vertically(
                        top_id,
                        bottom_id,
                        &mut layout_bounds_by_magnet_id,
                        viewport.height,
                        conflict.deficit_px,
                    );
                    max_adjustment_px = max_adjustment_px.max(resolved_px);
                    moved_in_iteration |= resolved_px > 0.0;
                } else {
                    let (left_id, right_id) = if first_bounds.x <= second_bounds.x {
                        (first_id, second_id)
                    } else {
                        (second_id, first_id)
                    };
                    let Some(left_bounds) = layout_bounds_by_magnet_id.get(left_id).copied() else {
                        continue;
                    };
                    let Some(right_bounds) = layout_bounds_by_magnet_id.get(right_id).copied()
                    else {
                        continue;
                    };
                    let left_ids = collect_horizontally_aligned_ids(
                        left_id,
                        left_bounds,
                        &layout_bounds_by_magnet_id,
                        &magnets_by_id,
                        &magnet_order,
                    );
                    let right_ids = collect_horizontally_aligned_ids(
                        right_id,
                        right_bounds,
                        &layout_bounds_by_magnet_id,
                        &magnets_by_id,
                        &magnet_order,
                    );
                    let resolved_px = shift_horizontally(
                        &left_ids,
                        &right_ids,
                        &mut layout_bounds_by_magnet_id,
                        viewport.width,
                        conflict.deficit_px,
                    );
                    max_adjustment_px = max_adjustment_px.max(resolved_px);
                    moved_in_iteration |= resolved_px > 0.0;
                }
            }
        }

        if !moved_in_iteration {
            break;
        }
    }

    let snap_adjustment_px = snap_rectangular_neighbor_seams(
        &mut layout_bounds_by_magnet_id,
        &magnets_by_id,
        &magnet_order,
        viewport,
    );
    max_adjustment_px = max_adjustment_px.max(snap_adjustment_px);

    let mut unresolved_conflicts = Vec::new();
    for index in 0..raw_bounds_entries.len() {
        let first_id = &raw_bounds_entries[index].0;
        for next_index in (index + 1)..raw_bounds_entries.len() {
            let second_id = &raw_bounds_entries[next_index].0;
            let Some(first_bounds) = layout_bounds_by_magnet_id.get(first_id).copied() else {
                continue;
            };
            let Some(second_bounds) = layout_bounds_by_magnet_id.get(second_id).copied() else {
                continue;
            };
            if let Some(conflict) =
                detect_pair_conflict(first_id, second_id, first_bounds, second_bounds)
            {
                unresolved_conflicts.push(conflict);
            }
        }
    }

    let out_of_bounds_ids = magnet_order
        .iter()
        .filter_map(|magnet_id| {
            let bounds = layout_bounds_by_magnet_id.get(magnet_id)?;
            if bounds.x < 0.0
                || bounds.y < 0.0
                || bounds.x + bounds.width > viewport.width
                || bounds.y + bounds.height > viewport.height
            {
                Some(magnet_id.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    let mode = if !unresolved_conflicts.is_empty() || !out_of_bounds_ids.is_empty() {
        MagnetAdaptiveLayoutMode::Constrained
    } else if max_adjustment_px > 0.0 {
        MagnetAdaptiveLayoutMode::Compact
    } else {
        MagnetAdaptiveLayoutMode::Normal
    };

    let aligned_layout_bounds_by_magnet_id: HashMap<String, MagnetBounds> =
        layout_bounds_by_magnet_id
            .iter()
            .map(|(magnet_id, bounds)| (magnet_id.clone(), align_magnet_bounds(*bounds)))
            .collect();

    MagnetAdaptiveLayoutResult {
        mode,
        layout_bounds_by_magnet_id: aligned_layout_bounds_by_magnet_id.clone(),
        joins_by_magnet_id: detect_magnet_joins(&aligned_layout_bounds_by_magnet_id, &magnet_order),
        diagnostics: MagnetAdaptiveDiagnostics {
            max_adjustment_px,
            out_of_bounds_ids,
            conflicts,
            unresolved_conflicts,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GeometryParityFixture {
        geometry_cases: Vec<GeometryParityCase>,
        adaptive_cases: Vec<AdaptiveLayoutParityCase>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MagnetGridFixture {
        origin_x: f64,
        origin_y: f64,
        step_x: f64,
        step_y: f64,
        cols: usize,
        rows: usize,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GeometryParityCase {
        name: String,
        grid: MagnetGridFixture,
        magnet: MagnetGeometryMagnet,
        #[serde(default)]
        magnets_by_id: Option<HashMap<String, MagnetGeometryMagnet>>,
        #[serde(default)]
        viewport: Option<Viewport>,
        #[serde(default)]
        join_edges: Option<MagnetBoundsJoinEdges>,
        expected_layout_bounds: Option<MagnetBounds>,
        expected_visual_bounds: Option<MagnetBounds>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AdaptiveLayoutParityCase {
        name: String,
        grid: MagnetGridFixture,
        magnets: Vec<MagnetGeometryMagnet>,
        viewport: Viewport,
        expected: MagnetAdaptiveLayoutResult,
    }

    fn create_pixel_positions(grid: &MagnetGridFixture) -> HashMap<String, PixelPosition> {
        let mut positions = HashMap::new();
        for grid_y in 0..grid.rows {
            for grid_x in 0..grid.cols {
                positions.insert(
                    format!("{grid_x},{grid_y}"),
                    PixelPosition {
                        x: grid.origin_x + grid_x as f64 * grid.step_x,
                        y: grid.origin_y + grid_y as f64 * grid.step_y,
                    },
                );
            }
        }
        positions
    }

    fn load_parity_fixture() -> GeometryParityFixture {
        serde_json::from_str(include_str!(
            "../../src/modules/magnets/magnetGeometryParityCases.json"
        ))
        .expect("parity fixture should parse")
    }

    #[test]
    fn geometry_bounds_match_ts_parity_fixture() {
        let fixture = load_parity_fixture();

        for case in fixture.geometry_cases {
            let pixel_positions = create_pixel_positions(&case.grid);
            let context = MagnetGeometryContext {
                magnets_by_id: case.magnets_by_id.as_ref(),
                viewport: case.viewport,
            };
            let layout_bounds = compute_magnet_bounds(&case.magnet, &pixel_positions, context);
            assert_eq!(
                layout_bounds, case.expected_layout_bounds,
                "layout bounds mismatch for {}",
                case.name
            );

            let visual_bounds = compute_magnet_visual_bounds(
                &case.magnet,
                &pixel_positions,
                context,
                case.join_edges,
            );
            assert_eq!(
                visual_bounds, case.expected_visual_bounds,
                "visual bounds mismatch for {}",
                case.name
            );
        }
    }

    #[test]
    fn adaptive_layout_matches_ts_parity_fixture() {
        let fixture = load_parity_fixture();

        for case in fixture.adaptive_cases {
            let pixel_positions = create_pixel_positions(&case.grid);
            let result =
                build_adaptive_magnet_layout(&case.magnets, &pixel_positions, case.viewport);
            assert_eq!(result, case.expected, "layout mismatch for {}", case.name);
        }
    }

    #[test]
    fn visual_bounds_apply_outset_without_content_inset_feedback() {
        let fixture = load_parity_fixture();
        let case = fixture
            .geometry_cases
            .into_iter()
            .find(|case| case.name == "single-control-chrome-join-collapse")
            .expect("chrome parity case exists");
        let pixel_positions = create_pixel_positions(&case.grid);
        let context = MagnetGeometryContext {
            magnets_by_id: case.magnets_by_id.as_ref(),
            viewport: case.viewport,
        };
        let layout_bounds = compute_magnet_bounds(&case.magnet, &pixel_positions, context);
        let content_bounds =
            compute_content_bounds_from_layout_bounds(layout_bounds, case.magnet.chrome.as_ref());

        assert_eq!(
            layout_bounds,
            Some(MagnetBounds {
                x: 11.0,
                y: 11.0,
                width: 36.0,
                height: 36.0,
            })
        );
        assert_eq!(
            content_bounds,
            Some(MagnetBounds {
                x: 21.0,
                y: 21.0,
                width: 16.0,
                height: 16.0,
            })
        );
    }
}
