import "d3-transition"; // required otherwise d3.select(..).transition won't work
import { select } from "d3-selection";
import { RadarContentProcessed, RadarDataSource } from "../DataSource/RadarDataSource.js";
import { RadarError } from "../Errors.js";
import { nestedAssign, RecursivePartial } from "../utils.js";
import { arrangeLabels } from "./arrangeLabels.js";
import { ItemLegend, ItemLegendConfig } from "./ItemLegend.js";
import { RadarPie, RadarPieConfig } from "./RadarPie.js";
import { RingLegend, RingLegendConfig } from "./RingLegend.js";

export type ContainerConfig = {
  width: number;
  height: number;
  center: { x: number; y: number };

  padding: number; // adjusting padding in css causing  auto scaling issues
};

export type RadarConfig = {
  container: RecursivePartial<ContainerConfig>;
  pie: RecursivePartial<RadarPieConfig>;
  itemLegend: RecursivePartial<ItemLegendConfig>;
  ringLegend: RecursivePartial<RingLegendConfig>;
};

export const DEFAULT_CONTAINER_CONFIG: ContainerConfig = {
  width: 900,
  height: 500,
  center: { x: 450, y: 250 }, // transform svg center to this point (new 0,0)
  padding: 20, // adjusting padding in css causing  auto scaling issues
};

export class RadarContainer {
  config: RecursivePartial<RadarConfig>;

  radarPie: RadarPie;
  itemLegend: ItemLegend;
  ringLegend: RingLegend;

  dataSource: RadarDataSource;
  radarContent: RadarContentProcessed;

  constructor(config: RecursivePartial<RadarConfig> = {}) {
    this.config = Object.assign({}, config);

    this.config.container = nestedAssign(DEFAULT_CONTAINER_CONFIG, this.config.container);

    const defaultItemLegend: Partial<ItemLegendConfig> = {
      pos: {
        x: (this.config.container.width / 8) * 5,
        y: 30,
      },
    };
    this.config.itemLegend = nestedAssign(defaultItemLegend, this.config.itemLegend);

    const defaultRingLegend: Partial<RingLegendConfig> = {
      pos: {
        x: (this.config.container.width / 8) * 5 + 50,
        y: 0,
      },
    };
    this.config.ringLegend = nestedAssign(defaultRingLegend, this.config.ringLegend);
  }

  public async fetchData(dataSource: RadarDataSource): Promise<RadarContentProcessed> {
    this.dataSource = dataSource;

    await this.dataSource.fetchData();
    this.radarContent = this.dataSource.getRadarContent();

    return this.radarContent;
  }

  public async appendTo(element: HTMLElement) {
    const svgElement = select(element)
      .append("svg")
      .classed("radar-svg-container", true)
      .attr("viewBox", `0 0 ${this.config.container.width} ${this.config.container.height}`);

    if (!this.dataSource && !this.radarContent) throw new RadarError("Call fetchData before calling getElement");

    const radarContainerGroup = svgElement
      .append("g")
      .classed("radar-container-group", true)
      .attr("transform", `translate (${this.config.container.center.x} ${this.config.container.center.y})`);

    this.radarPie = new RadarPie(this.radarContent, this.config.pie);
    radarContainerGroup.append(() => this.radarPie.getElement().node());

    this.itemLegend = new ItemLegend(this.radarContent.groups, this.radarPie.itemMarker, this.config.itemLegend);
    radarContainerGroup.append(() => this.itemLegend.getElement().node());

    this.ringLegend = new RingLegend(this.radarContent.rings, this.config.ringLegend);
    radarContainerGroup.append(() => this.ringLegend.getElement().node());

    await arrangeLabels(radarContainerGroup);

    RadarContainer.scaleToFit(
      radarContainerGroup,
      this.config.container.width,
      this.config.container.height,
      this.config.container.padding
    );

    return radarContainerGroup;
  }

  static scaleToFit(
    el: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>,
    newWidth: number,
    newHeight: number,
    padding: number
  ) {
    const node = el.node();
    const bb = node.getBBox();

    // center of element
    const cx = bb.x + bb.width / 2;
    const cy = bb.y + bb.height / 2;

    const scaleX = newWidth / (bb.width + padding * 2);
    const scaleY = newHeight / (bb.height + padding * 2);
    const scale = Math.min(scaleX, scaleY);
    // move to center
    const targetX = newWidth / 2;
    const targetY = newHeight / 2;

    // move its center to target x,y
    const transX = -cx * scale + targetX;
    const transY = -cy * scale + targetY;

    if (window.RADAR_DEBUG_MODE) {
      el.append("rect")
        .attr("x", bb.x - padding)
        .attr("y", bb.y - padding)
        .attr("width", bb.width + padding * 2)
        .attr("height", bb.height + padding * 2)
        .attr("fill", "none")
        .attr("stroke", "red");

      el.append("rect")
        .attr("x", bb.x)
        .attr("y", bb.y)
        .attr("width", bb.width)
        .attr("height", bb.height)
        .attr("fill", "none")
        .attr("stroke", "gray");

      console.log("svg container bBox", bb, "bb aspect ratio:", bb.width / bb.height);
      console.log("container size:", newWidth, newHeight, "aspect ratio:", newWidth / newHeight);
    }

    return el
      .transition()
      .duration(200)
      .attr("transform", "translate(" + transX + " " + transY + ")scale(" + scale + " " + scale + ")")
      .on("end", () => el.dispatch("scaleToFitEnd", { bubbles: true, detail: "DDDD", cancelable: true }));
  }
}
