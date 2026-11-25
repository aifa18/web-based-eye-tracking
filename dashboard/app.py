from __future__ import annotations
from io import BytesIO
import math
import pandas as pd
import plotly.express as px
import streamlit as st

st.set_page_config(page_title="GazeLab | Pilot Study", page_icon="👁", layout="wide")
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap');
html,body,[class*="css"]{font-family:'DM Sans',sans-serif}
.stApp{background:#0b1020;color:#e8edf8}
[data-testid="stHeader"]{background:rgba(11,16,32,.9)}
[data-testid="stSidebar"]{background:#11182b;border-right:1px solid #26314b}
[data-testid="stSidebar"] *{color:#e8edf8}
h1,h2,h3{font-family:'Manrope',sans-serif!important;letter-spacing:-.03em}
h1{font-size:2.3rem!important}
[data-testid="stMetric"]{background:linear-gradient(135deg,#151e34,#121a2c);border:1px solid #263653;padding:17px 19px;border-radius:16px}
[data-testid="stMetricLabel"]{color:#9caecb!important}
[data-testid="stMetricValue"]{color:#f3f7ff!important;font-family:'Manrope',sans-serif}
.block-container{padding-top:2rem;max-width:1500px}
.hero{background:radial-gradient(circle at 85% 15%,#243c62 0,#17243c 32%,#121a2c 70%);border:1px solid #2b3c5c;padding:27px 30px;border-radius:22px;margin-bottom:22px}
.eyebrow{color:#79e7d0;text-transform:uppercase;font-size:.75rem;font-weight:700;letter-spacing:.16em}
.hero h1{margin:8px 0;color:#f3f7ff}
.hero p,.muted{color:#b7c6df}
.pill{display:inline-block;border:1px solid #315c69;background:#132d39;color:#8debd7;padding:4px 10px;border-radius:999px;font-size:.78rem;font-weight:700}
.panel{background:#121a2c;border:1px solid #263653;border-radius:16px;padding:18px 20px}
hr{border-color:#263653!important}
</style>
""", unsafe_allow_html=True)

def read_csv(file):
    raw=file.getvalue()
    try: df=pd.read_csv(BytesIO(raw),encoding="utf-8-sig",sep=None,engine="python",on_bad_lines="warn")
    except Exception: df=pd.read_csv(BytesIO(raw),encoding="latin-1",sep=None,engine="python",on_bad_lines="warn")
    df.columns=[str(c).strip().replace("\ufeff","") for c in df.columns]
    df["_source_file"]=file.name
    return df

def first_col(df, options):
    return next((c for c in options if c in df.columns),None)

def numeric(df, cols):
    for c in cols:
        if c in df.columns: df[c]=pd.to_numeric(df[c],errors="coerce")

def csv_bytes(df):
    return df.to_csv(index=False).encode("utf-8-sig")

def fmt(v,suffix="",digits=2):
    try:
        if v is None or not math.isfinite(float(v)): return "—"
        return f"{float(v):,.{digits}f}{suffix}"
    except (TypeError,ValueError): return "—"

st.markdown("""
<div class="hero">
<div class="eyebrow">Eye tracking · Multi-camera pilot study</div>
<h1>GazeLab <span style="color:#7cebd4">/</span> Experiment Dashboard</h1>
<p>Compare the performance of a trained gaze model across cameras and acquisition configurations. Main results come from model predictions evaluated against ground truth—not from raw acquisition data.</p>
</div>
""",unsafe_allow_html=True)

with st.sidebar:
    st.markdown("## Study controls")
    st.caption("Main analysis")
    eval_files=st.file_uploader("Model inference / evaluation CSV",type=["csv"],accept_multiple_files=True,
        help="Upload evaluated model outputs with predicted gaze, ground truth, and degree error.")
    st.divider()
    st.markdown("### Supporting data")
    raw_files=st.file_uploader("Raw acquisition CSV (optional)",type=["csv"],accept_multiple_files=True,
        help="Used only for face-valid rate, FPS, detection time, and acquisition diagnostics.")
    st.divider()
    st.caption("Pilot results are exploratory; not final research conclusions.")

if not eval_files:
    st.markdown('<div class="panel"><span class="pill">WAITING FOR MODEL OUTPUT</span><h3 style="margin-top:14px">Start with evaluated predictions</h3><p class="muted">Upload the CSV exported after the trained model performs inference and its predictions are evaluated against ground truth.</p></div>',unsafe_allow_html=True)
    st.markdown("#### Required for the main dashboard")
    st.markdown("- Model predicted gaze X/Y\n- Ground-truth coordinates paired with predictions\n- Degree error per frame or per session\n- Camera, respondent/session, and experiment configuration")
    st.info("Raw acquisition data will not be used to calculate degree error or select the best model configuration.")
    st.stop()

parts=[]
for f in eval_files:
    try: parts.append(read_csv(f))
    except Exception as e: st.error(f"Cannot read {f.name}: {e}")
if not parts: st.stop()
data=pd.concat(parts,ignore_index=True,sort=False)
numeric(data,["mean_error_deg","frame_error_deg","point_hit_pct","frame_hit_pct","n_valid_test_frames","n_total_test_frames","timestamp_ms","point_id","target_x","target_y","predicted_gaze_x","predicted_gaze_y","distance_condition_cm","requested_video_w","requested_video_h","requested_frame_rate_fps","valid_prediction_rate_pct","valid_frame_rate_pct"])
for c in ["participant_id","camera_id","camera_label","test_session_id","scenario_id","model_version"]:
    if c in data: data[c]=data[c].fillna("Unknown").astype(str)

if "record_type" in data:
    frames=data[data.record_type.astype(str).str.lower().eq("frame")].copy()
    summary=data[data.record_type.astype(str).str.lower().eq("summary")].copy()
else:
    frames=data.copy() if "frame_error_deg" in data else pd.DataFrame()
    summary=data.copy() if "mean_error_deg" in data else pd.DataFrame()
if frames.empty and summary.empty:
    st.error("CSV format not recognized. Provide summary/frame records or frame_error_deg/mean_error_deg columns.")
    st.stop()

base=summary if not summary.empty else frames
with st.sidebar:
    st.markdown("### Filter results")
    def multiselect(df,col,label):
        if col not in df or df.empty:return None
        vals=sorted(df[col].dropna().astype(str).unique())
        return st.multiselect(label,vals,default=vals)
    people=multiselect(base,"participant_id","Respondent")
    cams=multiselect(base,"camera_label","Camera")
    sess=multiselect(base,"test_session_id","Session")
    scen=multiselect(base,"scenario_id","Scenario")
    dist=multiselect(base,"distance_condition_cm","Distance (cm)")

def filter_df(df):
    out=df.copy()
    for col,selected in [("participant_id",people),("camera_label",cams),("test_session_id",sess),("scenario_id",scen),("distance_condition_cm",dist)]:
        if selected is not None and col in out: out=out[out[col].astype(str).isin(selected)]
    return out
frames=filter_df(frames); summary=filter_df(summary)
errs=frames.frame_error_deg.dropna() if "frame_error_deg" in frames else pd.Series(dtype=float)
if not errs.empty: overall=float(errs.mean())
elif "mean_error_deg" in summary and not summary.mean_error_deg.dropna().empty:
    if "n_valid_test_frames" in summary:
        w=summary.n_valid_test_frames.fillna(0).clip(lower=0); valid=summary.mean_error_deg.notna() & w.gt(0)
        overall=float((summary.loc[valid,"mean_error_deg"]*w[valid]).sum()/w[valid].sum()) if valid.any() else float(summary.mean_error_deg.mean())
    else: overall=float(summary.mean_error_deg.mean())
else: overall=math.nan

camcol=first_col(base,["camera_label","camera_id"])
modelcol=first_col(base,["model_version","model_name"])
models=", ".join(sorted(base[modelcol].dropna().astype(str).unique())) if modelcol else "not specified"
st.markdown(f'<span class="pill">MODEL EVALUATION</span> &nbsp; <span class="muted">Model version: {models}</span>',unsafe_allow_html=True)
st.markdown("## Study overview")
cols=st.columns(5)
cols[0].metric("Respondents",base.participant_id.nunique() if "participant_id" in base else 0)
cols[1].metric("Cameras",base[camcol].nunique() if camcol else 0)
cols[2].metric("Sessions",base.test_session_id.nunique() if "test_session_id" in base else 0)
cols[3].metric("Valid test frames",f"{int(summary.n_valid_test_frames.fillna(0).sum()):,}" if "n_valid_test_frames" in summary else f"{len(errs):,}")
cols[4].metric("Mean degree error",fmt(overall,"°"))

t_over,t_cam,t_rank,t_point,t_frame,t_acq=st.tabs(["Overview","Camera comparison","Best configuration","Gaze accuracy map","Frame-level audit","Acquisition"])

with t_over:
    left,right=st.columns([1.35,1])
    with left:
        st.markdown("### Error distribution")
        if not errs.empty:
            fig=px.histogram(frames,x="frame_error_deg",nbins=35,labels={"frame_error_deg":"Angular error (°)"},template="plotly_dark")
            fig.update_layout(paper_bgcolor="rgba(0,0,0,0)",plot_bgcolor="rgba(0,0,0,0)",margin=dict(l=8,r=8,t=20,b=8))
            st.plotly_chart(fig,use_container_width=True)
        else: st.info("Frame-level error not provided; showing summary-level metrics.")
    with right:
        st.markdown("### Pilot snapshot")
        st.markdown(f'<div class="panel"><p><b>Camera count:</b> {base[camcol].nunique() if camcol else 0}</p><p><b>Respondents:</b> {base.participant_id.nunique() if "participant_id" in base else 0}</p><p><b>Evaluation rows:</b> {len(frames):,} frames · {len(summary):,} summaries</p><p class="muted">Compare configurations under equivalent experiment conditions.</p></div>',unsafe_allow_html=True)
    if not summary.empty:
        show=[c for c in ["participant_id","camera_label","scenario_id","test_session_id","distance_condition_cm","requested_video_w","requested_video_h","requested_frame_rate_fps","mean_error_deg","n_valid_test_frames","point_hit_pct","frame_hit_pct","model_version"] if c in summary]
        st.markdown("### Session evaluation")
        st.dataframe(summary[show],use_container_width=True,hide_index=True)
        st.download_button("Export evaluation summary",csv_bytes(summary[show]),"pilot_model_evaluation_summary.csv","text/csv")

with t_cam:
    st.markdown("### Camera performance")
    if camcol and "mean_error_deg" in summary and not summary.empty:
        group=[camcol]+[c for c in ["scenario_id","distance_condition_cm","requested_video_w","requested_video_h","requested_frame_rate_fps"] if c in summary]
        agg={"mean_error_deg":("mean_error_deg","mean")}
        if "n_valid_test_frames" in summary: agg["valid_frames"]=("n_valid_test_frames","sum")
        if "point_hit_pct" in summary: agg["point_hit_pct"]=("point_hit_pct","mean")
        if "frame_hit_pct" in summary: agg["frame_hit_pct"]=("frame_hit_pct","mean")
        comp=summary.groupby(group,dropna=False).agg(**agg).reset_index()
        fig=px.bar(comp,x=camcol,y="mean_error_deg",color=camcol,
            facet_col="scenario_id" if "scenario_id" in comp and comp.scenario_id.nunique()>1 else None,
            labels={camcol:"Camera","mean_error_deg":"Mean angular error (°)"},template="plotly_dark")
        fig.update_layout(showlegend=False,paper_bgcolor="rgba(0,0,0,0)",plot_bgcolor="rgba(0,0,0,0)")
        st.plotly_chart(fig,use_container_width=True)
        st.dataframe(comp.sort_values("mean_error_deg"),use_container_width=True,hide_index=True)
    else: st.info("Camera comparison requires camera identifier and mean_error_deg.")

with t_rank:
    st.markdown("### Configuration ranking")
    st.caption("Exploratory ranking by lowest mean degree error. Check prediction coverage and sample size before interpreting a leader.")
    if not summary.empty and "mean_error_deg" in summary:
        groups=[c for c in ["camera_label","camera_id","scenario_id","distance_condition_cm","requested_video_w","requested_video_h","requested_frame_rate_fps","track_settings_video_w","track_settings_video_h","track_settings_frame_rate_fps"] if c in summary]
        if not groups: groups=[camcol] if camcol else ["mean_error_deg"]
        rank=summary.groupby(groups,dropna=False).agg(
            mean_error_deg=("mean_error_deg","mean"),
            valid_frames=("n_valid_test_frames","sum") if "n_valid_test_frames" in summary else ("mean_error_deg","size"),
            sessions=("test_session_id","nunique") if "test_session_id" in summary else ("mean_error_deg","size")
        ).reset_index().sort_values("mean_error_deg",na_position="last")
        coverage=first_col(summary,["valid_prediction_rate_pct","valid_frame_rate_pct"])
        if coverage:
            cov=summary.groupby(groups,dropna=False)[coverage].mean().reset_index(name="prediction_coverage_pct")
            rank=rank.merge(cov,on=groups,how="left")
        if not rank.empty and rank.mean_error_deg.notna().any():
            best=rank.dropna(subset=["mean_error_deg"]).iloc[0]
            st.markdown('<div class="panel"><span class="pill">LOWEST OBSERVED ERROR</span><h3 style="margin-top:12px">Current pilot leader</h3>',unsafe_allow_html=True)
            st.metric("Mean degree error",f"{best.mean_error_deg:.2f}°")
            st.write(" · ".join(f"{g}: {best[g]}" for g in groups))
            st.markdown('<p class="muted">Candidate only. Not a final recommendation until coverage, sample size, and repeatability are assessed.</p></div>',unsafe_allow_html=True)
        st.dataframe(rank,use_container_width=True,hide_index=True)
        st.download_button("Export configuration ranking",csv_bytes(rank),"pilot_configuration_ranking.csv","text/csv")
    else: st.info("No summary degree error available for ranking.")

with t_point:
    st.markdown("### Spatial error")
    if not frames.empty and "point_id" in frames and "frame_error_deg" in frames:
        points=frames.groupby("point_id",dropna=False).agg(frames=("frame_error_deg","count"),mean_error_deg=("frame_error_deg","mean"),median_error_deg=("frame_error_deg","median")).reset_index()
        fig=px.scatter(points,x="point_id",y="mean_error_deg",size="frames",hover_data=["median_error_deg"],labels={"point_id":"Test point","mean_error_deg":"Mean error (°)"},template="plotly_dark")
        fig.update_layout(paper_bgcolor="rgba(0,0,0,0)",plot_bgcolor="rgba(0,0,0,0)")
        st.plotly_chart(fig,use_container_width=True)
        if {"target_x","target_y","predicted_gaze_x","predicted_gaze_y"}.issubset(frames.columns):
            fig2=px.scatter(frames,x="target_x",y="target_y",color="frame_error_deg",labels={"target_x":"Ground truth X","target_y":"Ground truth Y"},template="plotly_dark")
            fig2.add_scatter(x=frames.predicted_gaze_x,y=frames.predicted_gaze_y,mode="markers",name="Model prediction",marker=dict(symbol="x"))
            fig2.update_yaxes(autorange="reversed")
            fig2.update_layout(paper_bgcolor="rgba(0,0,0,0)",plot_bgcolor="rgba(0,0,0,0)")
            st.plotly_chart(fig2,use_container_width=True)
        st.dataframe(points,use_container_width=True,hide_index=True)
    else: st.info("Frame-level data requires point_id and frame_error_deg.")

with t_frame:
    st.markdown("### Prediction audit")
    if not frames.empty:
        show=[c for c in ["participant_id","camera_label","scenario_id","test_session_id","timestamp_ms","point_id","target_x","target_y","predicted_gaze_x","predicted_gaze_y","frame_error_deg","prediction_valid","model_version"] if c in frames]
        st.dataframe(frames[show] if show else frames,use_container_width=True,hide_index=True)
        st.download_button("Export frame-level predictions",csv_bytes(frames),"pilot_frame_level_predictions.csv","text/csv")
    else: st.info("Frame-level prediction output is not available.")

with t_acq:
    st.markdown("### Acquisition diagnostics")
    st.caption("Supporting camera-input quality only. These metrics do not calculate model degree error.")
    if not raw_files: st.info("Upload raw acquisition CSV in the sidebar to inspect diagnostics.")
    else:
        rawparts=[]
        for f in raw_files:
            try: rawparts.append(read_csv(f))
            except Exception as e: st.warning(f"Cannot read {f.name}: {e}")
        if rawparts:
            raw=pd.concat(rawparts,ignore_index=True,sort=False)
            numeric(raw,["detection_ms","measured_delivered_frame_rate_fps","track_settings_frame_rate_fps"])
            face=first_col(raw,["face_valid"])
            facepct=100*raw[face].astype(str).str.lower().isin(["true","1","yes","y"]).mean() if face else math.nan
            detect=float(raw.detection_ms.mean()) if "detection_ms" in raw and raw.detection_ms.notna().any() else math.nan
            fpscol=first_col(raw,["measured_delivered_frame_rate_fps","track_settings_frame_rate_fps"])
            fps=float(raw[fpscol].mean()) if fpscol and raw[fpscol].notna().any() else math.nan
            a,b,c=st.columns(3)
            a.metric("Raw frames",f"{len(raw):,}")
            b.metric("Face-valid rate",fmt(facepct,"%"))
            c.metric("Mean detection time",fmt(detect," ms"))
            if fpscol: st.metric("Delivered frame rate",fmt(fps," FPS"))
            st.dataframe(raw,use_container_width=True,hide_index=True)
            st.download_button("Export raw acquisition diagnostics",csv_bytes(raw),"pilot_raw_acquisition.csv","text/csv")

with st.expander("Metric definitions & research cautions"):
    st.markdown("""
    - Degree error must be computed from trained-model predictions against synchronized ground truth.
    - If frame_error_deg exists, overall error uses frame-level values; otherwise the summary mean is used.
    - Configuration ranking is exploratory for the currently filtered data, not a statistical conclusion.
    - Face-valid rate, FPS, and detection time describe acquisition quality; they do not replace gaze evaluation.
    - Compare equivalent respondent, distance, lighting, resolution, FPS, screen, and ground-truth conditions.
    - Verify the degree-conversion method and timestamp-pairing tolerance against the research protocol.
    """)
