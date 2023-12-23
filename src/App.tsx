import React from "react";
import ForceGraph, {
  ForceGraphMethods,
  GraphData,
  LinkObject,
  NodeObject
} from "react-force-graph-2d";

/* eslint-disable @typescript-eslint/ban-types */
type CustomNodeType = {};
type CustomLinkType = {};
type CustomGraphData = GraphData<
  NodeObject<CustomNodeType>,
  LinkObject<CustomNodeType, CustomLinkType>
>;
type GraphRef = ForceGraphMethods<
  NodeObject<CustomNodeType>,
  LinkObject<CustomNodeType, CustomLinkType>
>;

type ScrapedGraph = {
  [host: string]: string[];
};

export default function App() {
  const graphRef = React.useRef<GraphRef>();
  const [graphData, setGraphData] = React.useState<CustomGraphData | undefined>(
    undefined
  );

  React.useEffect(() => {
    async function createGraphData() {
      const graph: ScrapedGraph = await fetch("/graph.json").then((x) =>
        x.json()
      );

      const domains = Array.from(
        new Set(
          Object.entries(graph)
            .map((x) => x[1].concat([x[0]]))
            .flat()
        )
      );

      const nodes: CustomNodeType[] = domains.map((domain) => ({
        id: domain,
        name: domain,
        val: 1
      }));
      const links: CustomLinkType[] = Object.entries(graph)
        .map(([source, targets]) =>
          targets.map((target) => ({ source, target }))
        )
        .flat();
      setGraphData({ nodes, links });
    }

    createGraphData();
  }, []);

  const color = "lightgray";
  return (
    <>
      <ForceGraph
        graphData={graphData}
        enableNodeDrag={false}
        ref={graphRef}
        nodeAutoColorBy="id"
        linkHoverPrecision={30}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        backgroundColor="#000000"
        linkColor={() => color}
        linkDirectionalArrowColor={() => color}
        onNodeClick={(node) => {
          const url = `https://${node.id}/`;
          window.open(url, "_blank");
        }}
      />

      <div className="controls">
        <input
          type="text"
          placeholder="Search"
          onKeyDown={(e) => {
            if (e.key === "Enter" && graphData != null) {
              const node = graphData.nodes.find(
                (x) => x.id === (e.target as HTMLInputElement).value
              );
              if (node == null) return;
              graphRef.current?.centerAt(node.x!, node.y!, 1000);
              graphRef.current?.zoom(8, 1000);
            }
          }}
        />
      </div>
    </>
  );
}
