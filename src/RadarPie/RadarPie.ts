import * as d3 from "d3";
import { DEFAULT_ITEM_MARKER_CONFIG, ItemMarker, ItemMarkerConfig } from "./ItemMarker";
import { D3Element } from "../D3Element";
import {
  CatInfo,
  SliceProcessed,
  CatInfoSubSlice,
  RadarContentProcessed,
  SubSliceProcessed,
  RadarItemProcessed,
  SegmentProcessed,
} from "../DataSource/RadarDataSource";

import { RadarSegment } from "./RadarSegment";
import { degToRad } from "../geometricUtils";
import { nestedAssign, RecursivePartial, scaleProportional } from "../utils";

export type RadarPieConfig = {
  outerRadius: number;
  innerRadius: number;

  minSubSliceAngle: number; // in degrees

  subSlicePadAngle: number;

  sliceDividerOutFlowLength: number;

  sliceLabelDistance: number;
  subSliceLabelDistance: number;
  sliceLabelPadding: number;
  subSliceLabelPadding: number;

  minRingRadius: number;
  ringPadding: number;
  ringMinOpacity: number;
  ringMaxOpacity: number;

  itemMarker: Partial<ItemMarkerConfig> | ItemMarker;
};

export const DEFAULT_RADAR_PIE_CONFIG: RadarPieConfig = {
  outerRadius: 250,
  innerRadius: 0,

  minSubSliceAngle: 12, // in degrees

  subSlicePadAngle: 0.2, // in degrees

  minRingRadius: 30,
  ringPadding: 0,
  ringMinOpacity: 0.2,
  ringMaxOpacity: 1,

  sliceDividerOutFlowLength: 0,

  sliceLabelDistance: 60,
  subSliceLabelDistance: 10,
  sliceLabelPadding: 4,
  subSliceLabelPadding: 2,

  itemMarker: DEFAULT_ITEM_MARKER_CONFIG,
};

export interface SubSliceArcData extends d3.DefaultArcObject {
  data: CatInfoSubSlice;
}

export interface RadarItem extends RadarItemProcessed {
  x?: number;
  y?: number;
}

export interface TextPlacement {
  hAnchor: "middle" | "start" | "end";

  // http://bl.ocks.org/eweitnauer/7325338
  vAnchor:
    | "baseline"
    | "alphabetical"
    | "ideographic"
    | "hanging"
    | "mathematical"
    | "middle"
    | "central"
    | "text-before-edge"
    | "text-after-edge"; // "middle" | "top" | "bottom";
}

interface LabelData {
  // middle of the arc in subSliceLabelDistance or sliceLabel distance from the outer perimeter
  // actual anchoring position of the label is calculated after rendering (based on textAnchor and label bBox)
  x: number;
  y: number;
  bBoxPadding: number;
  labelPlacement: TextPlacement;
}

interface SliceLabelData extends LabelData {
  midAngle: number;
  dividerLine: { x1: number; y1: number; x2: number; y2: number };
}

export interface Segment extends SegmentProcessed {
  items: RadarItem[];
  arcParams?: d3.DefaultArcObject;
}

export interface SubSlice extends SubSliceProcessed {
  arcParams?: d3.DefaultArcObject;
  labelData?: LabelData;
  segments: Segment[];
}

export interface Slice extends SliceProcessed {
  labelData?: SliceLabelData;
  subSlices: SubSlice[];
}

export interface RingInfo extends CatInfo {
  opacity?: number;
  innerRadius?: number;
  radius?: number;
}

interface RadarContent {
  slices: Slice[];
  subSlices: CatInfoSubSlice[];
  rings: RingInfo[];
  groups: CatInfo[];
  items: RadarItem[];
}

export class RadarPie extends D3Element {
  radarContent: RadarContent;
  config: RadarPieConfig;
  itemMarker: ItemMarker;

  constructor(radarContentInput: Readonly<RadarContentProcessed>, config?: Readonly<RecursivePartial<RadarPieConfig>>) {
    super();
    this.radarContent = radarContentInput;
    this.config = nestedAssign(DEFAULT_RADAR_PIE_CONFIG, config);

    ////////////////////////////////////////////////////////////////////////////////////////////////
    // Create itemMarker
    if (this.config.itemMarker instanceof ItemMarker) {
      this.itemMarker = this.config.itemMarker;
    } else {
      this.itemMarker = new ItemMarker(radarContentInput.groups, this.config.itemMarker);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    // Calculate radius and opacity for each ring
    const availableRadius =
      this.config.outerRadius -
      this.config.innerRadius -
      this.config.ringPadding * (this.radarContent.rings.length - 1);

    const scaledRadiuses = scaleProportional(
      this.radarContent.rings.map(
        (r, level) => r.itemCount * Math.pow(this.radarContent.rings.length - level, 2) * Math.PI
      ),
      availableRadius,
      this.config.minRingRadius
    );

    this.radarContent.rings.forEach((ring, ringLevel) => {
      ring.opacity =
        ((this.config.ringMaxOpacity - this.config.ringMinOpacity) * (this.radarContent.rings.length - ringLevel - 1)) /
          (this.radarContent.rings.length - 1) +
        this.config.ringMinOpacity;

      ring.innerRadius =
        this.config.innerRadius +
        d3.sum(this.radarContent.rings, (r, idx) => (idx < ringLevel ? r.radius + this.config.ringPadding : 0));

      ring.radius = scaledRadiuses[ringLevel];
    });

    ////////////////////////////////////////////////////////////////////////////////////////////////
    // Calculate subSlices angles and label positions
    const scaledSubSlices = scaleProportional(
      this.radarContent.subSlices.map((r) => r.itemCount),
      360,
      this.config.minSubSliceAngle
    );

    const subSliceGen = d3
      .pie()
      .sort(null)
      .value((d, idx) => scaledSubSlices[idx])
      .padAngle(degToRad(this.config.subSlicePadAngle));

    const subSliceArcs = (subSliceGen(
      (this.radarContent.subSlices as unknown) as number[]
    ) as unknown) as SubSliceArcData[]; // we are passing CatInfoSubSlice[], it seems to be a @types/d3 issue

    subSliceArcs.forEach((arc) => {
      arc.innerRadius = this.config.innerRadius;
      arc.outerRadius = this.config.outerRadius;

      const subSlice = this.radarContent.slices
        .find((slice) => arc.data.sliceId === slice.id)
        .subSlices.find((subSlice) => subSlice.id === arc.data.id);

      subSlice.arcParams = arc;

      subSlice.labelData = {
        labelPlacement: RadarPie.calculateAnchorPlacement(subSlice.arcParams.startAngle, subSlice.arcParams.endAngle),
        bBoxPadding: this.config.subSliceLabelPadding,
        x:
          (subSlice.arcParams.outerRadius + this.config.subSliceLabelDistance) *
          Math.sin((subSlice.arcParams.endAngle - subSlice.arcParams.startAngle) / 2 + subSlice.arcParams.startAngle),

        y:
          -1 *
          (subSlice.arcParams.outerRadius + this.config.subSliceLabelDistance) *
          Math.cos((subSlice.arcParams.endAngle - subSlice.arcParams.startAngle) / 2 + subSlice.arcParams.startAngle),
      };

      ////////////////////////////////////////////////////////////////////////////////////////////////
      // calculate arc for each segment
      subSlice.segments.forEach((segment) => {
        const ringRadius = this.radarContent.rings.find((r) => r.id === segment.ringId).radius;
        const ringInnerRadius = this.radarContent.rings[segment.ringLevel].innerRadius;

        segment.arcParams = {
          startAngle: subSlice.arcParams.startAngle,
          endAngle: subSlice.arcParams.endAngle,
          padAngle: subSlice.arcParams.padAngle,
          innerRadius: ringInnerRadius,
          outerRadius: ringInnerRadius + ringRadius,
        };
      });
    });

    ////////////////////////////////////////////////////////////////////////
    //  calculate slice separator lines and slice label positions
    this.radarContent.slices.forEach((slice) => {
      const firstArcParams = slice.subSlices[0].arcParams;
      const lastArcParams = slice.subSlices[slice.subSlices.length - 1].arcParams;
      const midAngle = firstArcParams.startAngle + (lastArcParams.endAngle - firstArcParams.startAngle) / 2;

      slice.labelData = {
        x: Math.cos(midAngle - Math.PI / 2) * (firstArcParams.outerRadius + this.config.sliceLabelDistance),
        y: Math.sin(midAngle - Math.PI / 2) * (firstArcParams.outerRadius + this.config.sliceLabelDistance),
        labelPlacement: RadarPie.calculateAnchorPlacement(midAngle),
        bBoxPadding: this.config.sliceLabelPadding,

        midAngle,
        dividerLine: {
          x1: Math.cos(firstArcParams.startAngle - Math.PI / 2) * firstArcParams.innerRadius,
          y1: Math.sin(firstArcParams.startAngle - Math.PI / 2) * firstArcParams.innerRadius,
          x2:
            Math.cos(firstArcParams.startAngle - Math.PI / 2) *
            (firstArcParams.outerRadius + this.config.sliceDividerOutFlowLength),
          y2:
            Math.sin(firstArcParams.startAngle - Math.PI / 2) *
            (firstArcParams.outerRadius + this.config.sliceDividerOutFlowLength),
        },
      };
    });

    console.log("radarContent", this.radarContent);
  } // end constructor

  public getElement() {
    const pieGroup = d3.create(this.namespace + "g").classed("radar-pie-group", true);

    ////////////////////////////////////////////////////////////////////////
    //  add top level groups first to maintain layer "painting" order  at one place
    //    (so no need for.raise() & .lower()

    const sliceGroup = pieGroup
      .selectAll(".radar-slice-group")
      .data(this.radarContent.slices)
      .join((enter) =>
        enter
          .append("g")
          .classed("radar-slice-group", true)
          .attr("id", (slice) => "radar-slice-group-" + slice.id)
      );

    const sliceSepGroup = pieGroup.append("g").classed("slice-separator-group", true);

    const subSliceLabelGroup = pieGroup
      .append("g")
      .classed("labels-group", true)
      .classed("subSlice-labels-group", true);

    const sliceLabelGroup = pieGroup.append("g").classed("labels-group", true).classed("slice-labels-group", true);

    const itemMarkersGroup = pieGroup.append("g").classed("item-makers-group", true);

    ////////////////////////////////////////////////////////////////////////
    //  add slices and slice labels
    sliceLabelGroup
      .selectAll(".slice-label")
      .data(this.radarContent.slices)
      .join((enter) =>
        enter
          .append("svg")
          .style("overflow", "visible")

          .attr("x", (d) => d.labelData.x)
          .attr("y", (d) => d.labelData.y)

          .classed("label", true)
          .classed("slice-label", true)
          .attr("id", (d) => "slice-label-" + d.id)

          .append("text")
          .classed("slice-label-text", true)
          .classed("label-text", true)
          .text((d) => d.label)
          .style("text-anchor", (d) => d.labelData.labelPlacement.hAnchor)
          .style("dominant-baseline", (d) => d.labelData.labelPlacement.vAnchor)
      );

    ////////////////////////////////////////////////////////////////////////
    //  add slice separator lines
    sliceSepGroup
      .selectAll(".slice-separator-group")
      .data(this.radarContent.slices)
      .join((enter) =>
        enter
          .append("line")
          .classed("radar-slice-separator-line", true)
          .attr("x1", (d) => d.labelData.dividerLine.x1)
          .attr("y1", (d) => d.labelData.dividerLine.y1)
          .attr("x2", (d) => d.labelData.dividerLine.x2)
          .attr("y2", (d) => d.labelData.dividerLine.y2)
      );

    ////////////////////////////////////////////////////////////////////////
    //  add subSlices labels

    // TODO: make subSlice node the same in radarContent.slices so it's not needed
    const subSlices: SubSlice[] = this.radarContent.slices.reduce((acc, slice) => {
      acc.push(...slice.subSlices);
      return acc;
    }, []);

    subSliceLabelGroup
      .selectAll("svg")
      .data(subSlices.filter((d) => !d.isDummy)) // subSlice is "dummy", created during data import for a slice w/o subSlice
      .join((enter) =>
        enter
          .append("svg")
          .style("overflow", "visible")
          .attr("x", (subSlice) => subSlice.labelData.x)
          .attr("y", (subSlice) => subSlice.labelData.y)
          .classed("label", true)
          .classed("subSlice-label", true)

          .append("text")
          .attr("id", (subSlice) => "subSlice-label-" + subSlice.id)
          .classed("label-text", true)
          .classed("subSlice-label-text", true)
          .text((subSlice) => subSlice.label)
          .style("text-anchor", (subSlice) => subSlice.labelData.labelPlacement.hAnchor)
          .style("dominant-baseline", (subSlice) => subSlice.labelData.labelPlacement.vAnchor)
      );

    sliceGroup.each((slice, idx, nodes) => {
      const el = d3.select(nodes[idx]).selectAll(".radar-subSlice-group");
      const subSliceGroup = el.data(slice.subSlices).join((enter) =>
        enter
          .append("g")
          .classed("radar-subSlice-group", true)
          .attr("id", (subSlice) => "radar-subSlice-group-" + slice.id + "-" + subSlice.id)
      );

      ////////////////////////////////////////////////////////////////////////
      //  add segments and item markers
      subSliceGroup.each((subSlice, idx, nodes) => {
        const el = d3.select(nodes[idx]).selectAll(".radar-segment-group");
        const segmentGroup = el.data(subSlice.segments).join((enter) =>
          enter.append((segment, sIdx) => {
            // TODO: create RadarSegment objects at constructor (replace SegmentProcessed in radarContent )
            const radarSegment = new RadarSegment(segment, this.radarContent.rings);

            if (radarSegment.segment.items.length > 0) {
              itemMarkersGroup
                .append("g")
                .classed("item-marker-group-" + idx + "-" + sIdx, true)
                .append(() => this.itemMarker.getMultipleElements(radarSegment.segment.items).node());
            }

            return radarSegment.getElement().node();
          })
        );
      });
    });

    return pieGroup;
  } // getElement end

  static calculateAnchorPlacement(startOrMidAngle: number, endAngle?: number): TextPlacement {
    {
      let rads: number;
      const H_CUT_OFF_DEGREE = 10;
      const V_CUT_OFF_DEGREE = 45;

      if (!endAngle) rads = startOrMidAngle;
      else rads = (endAngle - startOrMidAngle) / 2 + startOrMidAngle;

      let anchor = <TextPlacement>{};
      // circle top section
      if (rads > degToRad(360 - H_CUT_OFF_DEGREE) || rads < degToRad(H_CUT_OFF_DEGREE)) anchor.hAnchor = "middle";
      // bottom section
      else if (rads > degToRad(180 - H_CUT_OFF_DEGREE) && rads < degToRad(180 + H_CUT_OFF_DEGREE))
        anchor.hAnchor = "middle";
      // right section
      else if (rads >= degToRad(H_CUT_OFF_DEGREE) && rads <= degToRad(180 - H_CUT_OFF_DEGREE)) anchor.hAnchor = "start";
      // left section
      else if (rads >= degToRad(180 + H_CUT_OFF_DEGREE) && rads <= degToRad(360 - H_CUT_OFF_DEGREE))
        anchor.hAnchor = "end";
      else throw new Error("Invalid rads for horizontal calculateAnchorPlacement: " + rads);

      // circle top section
      if (rads > degToRad(360 - V_CUT_OFF_DEGREE) || rads < degToRad(V_CUT_OFF_DEGREE)) anchor.vAnchor = "baseline";
      // bottom section
      else if (rads > degToRad(180 - V_CUT_OFF_DEGREE) && rads < degToRad(180 + V_CUT_OFF_DEGREE))
        anchor.vAnchor = "hanging";
      // right section
      else if (rads >= degToRad(V_CUT_OFF_DEGREE) && rads <= degToRad(180 - V_CUT_OFF_DEGREE))
        anchor.vAnchor = "middle";
      // left section
      else if (rads >= degToRad(180 + V_CUT_OFF_DEGREE) && rads <= degToRad(360 - V_CUT_OFF_DEGREE))
        anchor.vAnchor = "middle";
      else throw new Error("Invalid rads for vertical calculateAnchorPlacement: " + rads);

      return anchor;
    }
  }
}
