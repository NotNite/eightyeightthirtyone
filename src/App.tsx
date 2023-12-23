import { useWindowSize } from "@react-hook/window-size";
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
  const [origGraph, setOrigGraph] = React.useState<ScrapedGraph | undefined>(
    undefined
  );
  const [graphData, setGraphData] = React.useState<CustomGraphData | undefined>(
    undefined
  );
  const [selected, setSelected] = React.useState<string | null>(null);
  const [width, height] = useWindowSize();

  React.useEffect(() => {
    async function createGraphData() {
      const graph: ScrapedGraph = await fetch("/graph.json").then((x) =>
        x.json()
      );
      setOrigGraph(graph);

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

  function select(domain: string) {
    const node = graphData?.nodes.find((x) => x.id === domain);
    if (node == null) return;
    setSelected(node.id as string);
    graphRef.current?.centerAt(node.x!, node.y!, 1000);
    graphRef.current?.zoom(8, 1000);
  }

  const color = "grey";
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
        linkColor={(link) => {
          if (origGraph == null) return color;

          // @ts-expect-error cbf to type
          const source = link.source.id as string;
          // @ts-expect-error cbf to type
          const target = link.target.id as string;

          const sourceToTarget = origGraph[source]?.includes(target) === true;
          const targetToSource = origGraph[target]?.includes(source) === true;

          if (sourceToTarget && targetToSource) return "white";
          return color;
        }}
        linkDirectionalArrowColor={() => color}
        onNodeClick={(node) => {
          setSelected(node.id as string);
        }}
        onBackgroundClick={() => {
          setSelected(null);
        }}
        width={width}
        height={height}
      />

      <div className="controls">
        <input
          type="text"
          placeholder="Search"
          onKeyDown={(e) => {
            if (e.key === "Enter" && graphData != null) {
              select(e.currentTarget.value);
            }
          }}
        />
        <span className="by">
          A{" "}
          <a href="https://github.com/NotNite/eightyeightthirtyone">project</a>{" "}
          by{" "}
          <a href="https://notnite.com/">
            <img src="/notnite.png" alt="notnite" />
          </a>
        </span>
      </div>

      {selected != null && (
        <div className="infobox">
          <div className="infoboxInner">
            <a href={`https://${selected}`} target="_blank" rel="noreferrer">
              <h3>{selected}</h3>
            </a>

            <span>Links to:</span>
            <ul>
              {origGraph != null &&
                origGraph[selected] != null &&
                origGraph[selected].map((x, i) => (
                  <li key={i}>
                    <button onClick={() => select(x)}>{x}</button>
                  </li>
                ))}
            </ul>

            <span>Linked from:</span>
            <ul>
              {origGraph != null &&
                Object.entries(origGraph)
                  .filter((x) => x[1].includes(selected))
                  .map((x, i) => (
                    <li key={i}>
                      <button onClick={() => select(x[0])}>{x[0]}</button>
                    </li>
                  ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
