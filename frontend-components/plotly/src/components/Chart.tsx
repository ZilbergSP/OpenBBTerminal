// @ts-nocheck
import * as Plotly from "plotly.js-dist-min";
import { usePostHog } from "posthog-js/react";
import createPlotlyComponent from "react-plotly.js/factory";
import { useState, useEffect } from "react";
import { ICONS, DARK_CHARTS_TEMPLATE, LIGHT_CHARTS_TEMPLATE } from "./Config";
import OverlayChartDialog from "./Dialogs/OverlayChartDialog";
import TitleChartDialog from "./Dialogs/TitleChartDialog";
import TextChartDialog from "./Dialogs/TextChartDialog";
import { Icons as PlotlyIcons } from "plotly.js-dist-min";
import { init_annotation } from "../utils/addAnnotation";
import { PlotConfig, hideModebar } from "./PlotlyConfig";
import autoScaling from "./AutoScaling";
import { non_blocking, saveImage } from "../utils/utils";
import ResizeHandler from "./ResizeHandler";
import ChangeColor from "./ChangeColor";
import clsx from "clsx";
import DownloadFinishedDialog from "./Dialogs/DownloadFinishedDialog";

const Plot = createPlotlyComponent(Plotly);

function CreateDataXrangeChunks(data: Plotly.PlotData[], xrange?: any) {
	const chunks = [];
	let chunk = [];
	const XDATA = data.filter(
		(trace) =>
			trace.x !== undefined && trace.x.length > 0 && trace.x[0] !== undefined,
	);
	const xaxis = XDATA[0]?.x ? XDATA[0].x : XDATA[1].x ? XDATA[1].x : [];
	for (let i = 0; i < xaxis.length; i++) {
		if (xaxis[i] >= xrange[0] && xaxis[i] <= xrange[1]) {
			chunk.push(i);
		} else if (chunk.length > 0) {
			chunks.push(chunk);
			chunk = [];
		}
	}

	if (chunk.length > 0) chunks.push(chunk);
	return chunks;
}

function CreateDataXrange(data: Plotly.PlotData[], xrange?: any) {
	if (!xrange) {
		xrange = [
			data[0]?.x[data[0].x.length - 1000],
			data[0]?.x[data[0].x.length - 1],
		];
	}
	const chunks = CreateDataXrangeChunks(data, xrange);
	const new_data = [];
	chunks.forEach((chunk) => {
		data.forEach((trace) => {
			const new_trace = { ...trace };
			const data_keys = ["x", "y", "low", "high", "open", "close", "text"];
			data_keys.forEach((key) => {
				if (trace[key] && Array.isArray(trace[key])) {
					new_trace[key] = trace[key].filter((_, i) => chunk.includes(i));
				}
			});
			const color_keys = ["marker", "line"];
			color_keys.forEach((key) => {
				if (trace[key]?.color && Array.isArray(trace[key].color)) {
					new_trace[key] = { ...trace[key] };
					new_trace[key].color = trace[key].color.filter((_, i) =>
						chunk.includes(i),
					);
				}
			});
			new_data.push(new_trace);
		});
	});

	if (new_data.length === 0) return data;

	return new_data;
}

async function DynamicLoad({
	event,
	figure,
}: {
	event?: any;
	figure: any;
}) {
	try {
		const XDATA = figure.data.filter(
			(trace) =>
				trace.x !== undefined && trace.x.length > 0 && trace.x[0] !== undefined,
		);

		if (XDATA.length === 0) return figure;
		// We get the xaxis range, if no event is passed, we get the last 1000 points
		const xaxis_range = event
			? [event["xaxis.range[0]"], event["xaxis.range[1]"]]
			: [
					XDATA[0]?.x[XDATA[0].x.length - 1000],
					XDATA[0]?.x[XDATA[0].x.length - 1],
			  ];

		const new_data = CreateDataXrange(figure.data, xaxis_range);
		figure.data = new_data;
		figure.layout.xaxis.range = xaxis_range;
		return figure;
	} catch (e) {
		console.log("error", e);
	}
}

export default function Chart({
	json,
	date,
	cmd,
	title,
	globals,
	theme,
	info,
}: {
	// @ts-ignore
	json: Figure;
	date: Date;
	cmd: string;
	title: string;
	globals: any;
	theme: string;
	info?: any;
}) {
	const posthog = usePostHog();

	useEffect(() => {
		if (posthog) posthog.capture("chart", info);
	}, []);

	json.layout.width = undefined;
	json.layout.height = undefined;
	if (json.layout?.title?.text) {
		json.layout.title.text = "";
	}

	const [originalData, setOriginalData] = useState(json);
	const [barButtons, setModeBarButtons] = useState({});
	const [LogYaxis, setLogYaxis] = useState(false);
	const [chartTitle, setChartTitle] = useState(title);
	const [axesTitles, setAxesTitles] = useState({});
	const [plotLoaded, setPlotLoaded] = useState(false);
	const [modal, setModal] = useState({ name: "" });
	const [loading, setLoading] = useState(false);
	const [plotDiv, setPlotDiv] = useState(null);
	const [volumeBars, setVolumeBars] = useState({ old_nticks: {} });
	const [maximizePlot, setMaximizePlot] = useState(false);
	const [downloadFinished, setDownloadFinished] = useState(false);

	const [plotData, setPlotData] = useState(originalData);
	const [annotations, setAnnotations] = useState([]);
	const [changeTheme, setChangeTheme] = useState(false);
	const [darkMode, setDarkMode] = useState(true);
	const [autoScale, setAutoScaling] = useState(false);
	const [changeColor, setChangeColor] = useState(false);
	const [colorActive, setColorActive] = useState(false);
	const [onAnnotationClick, setOnAnnotationClick] = useState({});
	const [ohlcAnnotation, setOhlcAnnotation] = useState([]);

	const onClose = () => setModal({ name: "" });

	useEffect(() => {
		if (!plotLoaded) {
			if (
				originalData.data[0]?.x !== undefined &&
				originalData.data[0]?.x.length <= 1000
			)
				return;
			const new_data = CreateDataXrange(originalData.data);
			setPlotData({ ...originalData, data: new_data });
		}
	}, [plotLoaded]);

	// @ts-ignore
	function onDeleteAnnotation(annotation) {
		console.log("onDeleteAnnotation", annotation);
		const index = plotData?.layout?.annotations?.findIndex(
			(a: any) => a.text === annotation.text,
		);
		console.log("index", index);
		if (index > -1) {
			plotData?.layout?.annotations?.splice(index, 1);
			setPlotData({ ...plotData });
			setAnnotations(plotData?.layout?.annotations);
		}
	}

	// @ts-ignore
	function onAddAnnotation(data) {
		init_annotation({
			plotData,
			popupData: data,
			setPlotData,
			setModal,
			setOnAnnotationClick,
			setAnnotations,
			onAnnotationClick,
			ohlcAnnotation,
			setOhlcAnnotation,
			annotations,
			plotDiv,
		});
	}

	useEffect(() => {
		if (downloadFinished) {
			setModal({ name: "downloadFinished" });
			setDownloadFinished(false);
		}
	}, [downloadFinished]);

	useEffect(() => {
		if (axesTitles && Object.keys(axesTitles).length > 0) {
			Object.keys(axesTitles).forEach((k) => {
				plotData.layout[k].title = {
					...(plotData.layout[k].title || {}),
					text: axesTitles[k],
				};
				plotData.layout[k].showticklabels = true;
			});
			setAxesTitles({});
		}
	}, [axesTitles]);

	function onChangeColor(color) {
		// updates the color of the last added shape
		// this function is called when the color picker is used
		// if there are no shapes, we remove the color picker
		const shapes = plotDiv.layout.shapes;
		if (!shapes || shapes.length === 0) {
			return;
		}
		// we change last added shape color
		const last_shape = shapes[shapes.length - 1];
		last_shape.line.color = color;
		Plotly.update(plotDiv, {}, { shapes: shapes });
	}

	function button_pressed(title, active = false) {
		// changes the style of the button when it is pressed
		// title is the title of the button
		// active is true if the button is active, false otherwise

		const button =
			barButtons[title] || document.querySelector(`[data-title="${title}"]`);
		if (!active) {
			button.style.border = "1px solid rgba(0, 151, 222, 1.0)";
			button.style.borderRadius = "5px";
			button.style.borderpadding = "5px";
			button.style.boxShadow = "0 0 5px rgba(0, 151, 222, 1.0)";
		} else {
			button.style.border = "transparent";
			button.style.boxShadow = "none";
		}
		setModeBarButtons({ ...barButtons, [title]: button });
	}

	function autoscaleButton() {
		// We need to check if the button is active or not
		const title = "Auto Scale (Ctrl+Shift+A)";
		const button =
			barButtons[title] || document.querySelector(`[data-title="${title}"]`);
		let active = true;

		if (button.style.border === "transparent") {
			active = false;
			plotDiv.on(
				"plotly_relayout",
				non_blocking(async function (eventdata) {
					if (eventdata["xaxis.range[0]"] === undefined) return;

					const to_update = await autoScaling(eventdata, plotDiv);
					Plotly.update(plotDiv, {}, to_update);
				}, 100),
			);
		}
		// If the button isn't active, we remove the listener so
		// the graphs don't autoscale anymore
		else plotDiv.removeAllListeners("plotly_relayout");

		button_pressed(title, active);
	}

	function changecolorButton() {
		// We need to check if the button is active or not
		const title = "Edit Color (Ctrl+E)";
		const button =
			barButtons[title] || document.querySelector(`[data-title="${title}"]`);
		let active = true;

		if (button.style.border === "transparent") {
			active = false;
		}

		setColorActive(!active);
		button_pressed(title, active);
	}

	useEffect(() => {
		if (autoScale) {
			const scale = !autoScale;
			console.log("activateAutoScale", scale);
			autoscaleButton();
			setAutoScaling(false);
		}
	}, [autoScale]);

	useEffect(() => {
		if (changeColor) {
			changecolorButton();
			setChangeColor(false);
		}
	}, [changeColor]);

	useEffect(() => {
		if (changeTheme) {
			try {
				console.log("changeTheme", changeTheme);
				const TRACES = plotData?.data.filter((trace) =>
					trace?.name?.startsWith("Volume"),
				);
				const darkmode = !darkMode;

				window.document.body.style.backgroundColor = darkmode ? "#000" : "#fff";

				plotData.layout.font = {
					...(plotData.layout.font || {}),
					color: darkmode ? "#fff" : "#000",
				};

				const changeIcon = darkmode ? ICONS.sunIcon : ICONS.moonIcon;

				document
					.querySelector('[data-title="Change Theme"]')
					.getElementsByTagName("path")[0]
					.setAttribute("d", changeIcon.path);

				document
					.querySelector('[data-title="Change Theme"]')
					.getElementsByTagName("svg")[0]
					.setAttribute("viewBox", changeIcon.viewBox);

				const volumeColorsDark = {
					"#009600": "#00ACFF",
					"#c80000": "#e4003a",
				};
				const volumeColorsLight = {
					"#e4003a": "#c80000",
					"#00ACFF": "#009600",
				};

				const volumeColors = darkmode ? volumeColorsDark : volumeColorsLight;

				TRACES.forEach((trace) => {
					if (trace.type === "bar")
						trace.marker.color = trace.marker.color.map((color) => {
							return volumeColors[color] || color;
						});
				});
				plotData.layout.template = darkmode
					? DARK_CHARTS_TEMPLATE
					: LIGHT_CHARTS_TEMPLATE;
				setPlotData({ ...plotData });
				Plotly.react(plotDiv, plotData.data, plotData.layout);
				setDarkMode(darkmode);
				setChangeTheme(false);
			} catch (e) {
				console.log("error", e);
			}
		}
	}, [changeTheme]);

	useEffect(() => {
		if (plotLoaded) {
			setDarkMode(true);
			setAutoScaling(false);
			const captureButtons = [
				"Download CSV",
				"Download Chart as Image",
				"Overlay chart from CSV",
				"Add Text",
				"Change Titles",
				"Auto Scale (Ctrl+Shift+A)",
				"Reset Axes",
			];
			const autoscale = document.querySelector('[data-title="Autoscale"]');
			if (autoscale) {
				autoscale
					.getElementsByTagName("path")[0]
					.setAttribute("d", PlotlyIcons.home.path);
				autoscale.setAttribute("data-title", "Reset Axes");
			}

			window.MODEBAR = document.getElementsByClassName(
				"modebar-container",
			)[0] as HTMLElement;
			const modeBarButtons = window.MODEBAR.getElementsByClassName(
				"modebar-btn",
			) as HTMLCollectionOf<HTMLElement>;

			window.MODEBAR.style.cssText = `${window.MODEBAR.style.cssText}; display:flex;`;

			if (modeBarButtons) {
				const barbuttons: any = {};
				for (let i = 0; i < modeBarButtons.length; i++) {
					const btn = modeBarButtons[i];
					if (captureButtons.includes(btn.getAttribute("data-title"))) {
						btn.classList.add("ph-capture");
					}
					btn.style.border = "transparent";
					barbuttons[btn.getAttribute("data-title")] = btn;
				}
				setModeBarButtons(barbuttons);
			}

			if (plotData?.layout?.yaxis?.type !== undefined) {
				if (plotData.layout.yaxis.type === "log" && !LogYaxis) {
					console.log("yaxis.type changed to log");
					setLogYaxis(true);

					// const layout_update = {
					//   "yaxis.exponentformat": "none"
					// };
					// Plotly.update(plotDiv, {}, layout_update);
				}
				if (plotData.layout.yaxis.type === "linear" && LogYaxis) {
					console.log("yaxis.type changed to linear");
					setLogYaxis(false);

					// We update the yaxis exponent format to none,
					// set the tickformat to null and the exponentbase to 10
					const layout_update = {
						"yaxis.exponentformat": "none",
						"yaxis.tickformat": null,
						"yaxis.exponentbase": 10,
					};
					Plotly.update(plotDiv, {}, layout_update);
				}
			}

			// We check to see if window.export_image is defined
			if (window.export_image !== undefined) {
				// We get the extension of the file and check if it is valid
				const filename = window.export_image.split("/").pop();
				const extension = filename.split(".").pop().replace("jpg", "jpeg");

				if (["jpeg", "png", "svg", "pdf"].includes(extension))
					non_blocking(async function () {
						await hideModebar();
						await saveImage("MainChart", filename.split(".")[0], extension);
					}, 2)();
			}

			window.addEventListener("resize", async function () {
				const update = await ResizeHandler({
					plotData,
					volumeBars,
					setMaximizePlot,
				});
				const layout_update = update.layout_update;
				const newPlotData = update.plotData;
				const volume_update = update.volume_update;

				if (Object.keys(layout_update).length > 0) {
					setPlotData(newPlotData);
					setVolumeBars(volume_update);
					Plotly.relayout(plotDiv, layout_update);
				}
			});
			plotDiv.on(
				"plotly_relayout",
				non_blocking(async function (eventdata) {
					if (eventdata["xaxis.range[0]"] === undefined) return;
					const data = { ...originalData };
					const to_update = DynamicLoad({
						event: eventdata,
						figure: data,
					});
					const newPlotData = await to_update;
					setPlotData(newPlotData);

					Plotly.react(plotDiv, newPlotData.data, newPlotData.layout);
					const scaled = await autoScaling(eventdata, plotDiv);
					Plotly.update(plotDiv, {}, scaled);
				}, 10),
			);
			if (theme !== "dark") {
				setChangeTheme(true);
			}
		}
	}, [plotLoaded]);

	return (
		<div className="relative h-full">
			{loading && (
				<div className="absolute inset-0 flex items-center justify-center z-[100]">
					<svg
						className="animate-spin h-20 w-20 text-white"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle
							className="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							strokeWidth="4"
						/>
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8v8z"
						/>
					</svg>
				</div>
			)}
			<div id="loading" className="saving">
				<div id="loading_text" className="loading_text" />
				<div id="loader" className="loader" />
			</div>
			<OverlayChartDialog
				addOverlay={(overlay) => {
					console.log(overlay);
					plotData.layout.showlegend = true;
					setPlotData(overlay);
					setPlotLoaded(false);
				}}
				plotlyData={plotData}
				setLoading={setLoading}
				open={modal.name === "overlayChart"}
				close={onClose}
			/>
			<TitleChartDialog
				updateTitle={(title) => setChartTitle(title)}
				updateAxesTitles={(axesTitles) => setAxesTitles(axesTitles)}
				defaultTitle={chartTitle}
				plotlyData={plotData}
				open={modal.name === "titleDialog"}
				close={onClose}
			/>
			<TextChartDialog
				popupData={modal.name === "textDialog" ? modal?.data : null}
				open={modal.name === "textDialog"}
				close={onClose}
				addAnnotation={(data) => onAddAnnotation(data)}
				deleteAnnotation={(data) => onDeleteAnnotation(data)}
			/>
			<ChangeColor open={colorActive} onColorChange={onChangeColor} />
			<DownloadFinishedDialog
				open={modal.name === "downloadFinished"}
				close={onClose}
			/>

			<div className="relative h-full" id="MainChart">
				<div className="_header relative gap-4 py-2 text-center text-xs flex items-center justify-between px-4 text-white">
					<div className="w-1/3">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="64"
							height="40"
							fill="none"
							viewBox="0 0 64 40"
						>
							<path
								fill="#fff"
								d="M61.283 3.965H33.608v27.757h25.699V19.826H37.561v-3.965H63.26V3.965h-1.977zM39.538 23.792h15.815v3.965H37.561v-3.965h1.977zM59.306 9.913v1.983H37.561V7.931h21.745v1.982zM33.606 0h-3.954v3.965H33.606V0zM25.7 3.966H0V15.86h25.7v3.965H3.953v11.896h25.7V3.966h-3.955zm0 21.808v1.983H7.907v-3.965h17.791v1.982zm0-15.86v1.982H3.953V7.931h21.745v1.982zM37.039 35.693v2.952l-.246-.246-.245-.245-.245-.247-.245-.246-.246-.246-.245-.245-.245-.247-.247-.246-.245-.246-.245-.246-.245-.246-.246-.246h-.49v3.936h.49v-3.198l.246.246.245.246.245.246.245.246.246.246.246.246.245.247.246.245.245.246.245.247.245.246.246.245.245.246h.245v-3.936h-.49zM44.938 37.17h-.491v-1.477h-2.944v3.937h3.93v-2.46h-.495zm-2.944-.246v-.739h1.962v.984h-1.962v-.245zm2.944.984v1.23h-2.944V37.66h2.944v.247zM52.835 37.17h-.49v-1.477h-2.946v3.937h3.925v-2.46h-.489zm-2.944-.246v-.739h1.963v.984h-1.965l.002-.245zm2.944.984v1.23H49.89V37.66h2.946v.247zM29.174 35.693H25.739v3.936H29.663v-.491H26.229v-.984h2.943v-.493H26.229v-1.476h3.434v-.492h-.489zM13.37 35.693H9.934v3.937h3.925v-3.937h-.49zm0 .738v2.709h-2.945v-2.955h2.943l.001.246zM21.276 35.693h-3.435v3.937h.491v-1.476h3.434v-2.461h-.49zm0 .738v1.23h-2.944v-1.476h2.944v.246z"
							/>
						</svg>
					</div>
					<p className="font-bold w-1/3 flex flex-col gap-0.5 items-center">
						{chartTitle}
						{/* {source && (
						<span className="font-normal text-[10px]">{`[${source}]`}</span>
					)} */}
					</p>
					<p className="w-1/3 text-right text-xs">
						{new Intl.DateTimeFormat("en-GB", {
							dateStyle: "full",
							timeStyle: "long",
						})
							.format(date)
							.replace(/:\d\d /, " ")}
						<br />
						<span className="text-grey-400">{cmd}</span>
					</p>
					{/* {source && typeof source === "string" && source.includes("*") && (
					<p className="text-[8px] absolute bottom-0 right-4">
						*not affiliated
					</p>
				)} */}
				</div>
				<div
					className={clsx("w-full sm:pb-12", {
						"h-[calc(100%-10px)]": maximizePlot,
						"h-[calc(100%-50px)]": !maximizePlot,
					})}
				>
					<Plot
						onInitialized={() => {
							if (!plotDiv) {
								const plot = document.getElementById("plotlyChart");
								console.log("plot", plot);
								if (plot) setPlotDiv(plot);
								plot.globals = globals;
							}
							if (!plotLoaded) setPlotLoaded(true);
						}}
						className="w-full h-full"
						divId="plotlyChart"
						data={plotData.data}
						layout={plotData.layout}
						config={PlotConfig({
							setModal: setModal,
							changeTheme: setChangeTheme,
							autoScaling: setAutoScaling,
							Loading: setLoading,
							changeColor: setChangeColor,
							downloadFinished: setDownloadFinished,
						})}
					/>
				</div>
			</div>
		</div>
	);
}