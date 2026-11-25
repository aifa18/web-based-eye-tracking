from __future__ import annotations
from io import BytesIO
import math
import pandas as pd
import plotly.express as px
import streamlit as st

st.set_page_config(page_title="Eye Tracking Dashboard", page_icon="👁️", layout="wide")
st.title("Eye Tracking Research Dashboard")
st.caption("Analisis hasil akuisisi, kalibrasi, dan evaluasi gaze test grid.")

def read_csv(file):
    raw = file.getvalue()
    try:
        df = pd.read_csv(BytesIO(raw), encoding="utf-8-sig", sep=None, engine="python", on_bad_lines="warn")
    except Exception:
        df = pd.read_csv(BytesIO(raw), encoding="latin-1", sep=None, engine="python", on_bad_lines="warn")
    df.columns = [str(c).strip().replace("\ufeff", "") for c in df.columns]
    df["_source_file"] = file.name
    return df

def num(df, columns):
    for c in columns:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

def bool_series(s):
    return s.astype(str).str.strip().str.lower().isin(["true", "1", "yes", "y"])

def first_col(df, choices):
    return next((c for c in choices if c in df.columns), None)

def csv_bytes(df):
    return df.to_csv(index=False).encode("utf-8-sig")

files = st.file_uploader("Unggah CSV (bisa beberapa file sekaligus)", type=["csv"], accept_multiple_files=True)
if not files:
    st.info("Unggah CSV evaluasi test grid (test-evaluation_...) dan CSV raw kalibrasi/test (calibration_...).")
    with st.expander("Jenis data yang dibaca"):
        st.markdown("""
        - Test evaluation: baris record_type summary dan frame; digunakan untuk gaze error (°), point/frame hit rate, dan prediksi gaze.
        - Raw acquisition: digunakan untuk face-valid rate, fixation, FPS, detection time, timestamp, serta metadata kamera.
        - Raw kalibrasi tidak dianggap sebagai gaze error. Gaze error diambil dari frame_error_deg hasil evaluasi test grid.
        """)
    st.stop()

parts = []
for file in files:
    try:
        parts.append(read_csv(file))
    except Exception as e:
        st.error(f"Tidak dapat membaca {file.name}: {e}")
if not parts:
    st.stop()

data = pd.concat(parts, ignore_index=True, sort=False)
if "record_type" in data.columns:
    eval_data = data[data.record_type.astype(str).str.lower().isin(["summary", "frame"])].copy()
    raw = data[~data.record_type.astype(str).str.lower().isin(["summary", "frame"])].copy()
else:
    eval_data, raw = pd.DataFrame(), data.copy()

numeric = [
    "mean_error_deg", "frame_error_deg", "point_hit_pct", "frame_hit_pct",
    "n_valid_test_frames", "n_training_frames", "frame_index", "timestamp_ms",
    "point_id", "target_x", "target_y", "predicted_gaze_x", "predicted_gaze_y",
    "distance_condition_cm", "actual_viewing_distance_cm", "screen_width_cm",
    "detection_ms", "measured_delivered_frame_rate_fps", "track_settings_frame_rate_fps",
    "requested_frame_rate_fps", "viewing_distance_cm", "fixation_dispersion",
    "requested_video_w", "requested_video_h", "track_settings_video_w", "track_settings_video_h",
]
num(eval_data, numeric)
num(raw, numeric)

if "participant_id" in eval_data.columns:
    eval_data["participant_id"] = eval_data["participant_id"].fillna("(ID kosong)").astype(str)
if "camera_id" in eval_data.columns:
    eval_data["camera_id"] = eval_data["camera_id"].fillna("(kamera tidak diketahui)").astype(str)
if "camera_label" in eval_data.columns:
    fallback = eval_data["camera_id"] if "camera_id" in eval_data.columns else pd.Series("Kamera tidak diketahui", index=eval_data.index)
    eval_data["camera_label"] = eval_data["camera_label"].fillna(fallback).astype(str)

if "record_type" in eval_data.columns:
    summary = eval_data[eval_data.record_type.astype(str).str.lower().eq("summary")].copy()
    frames = eval_data[eval_data.record_type.astype(str).str.lower().eq("frame")].copy()
else:
    summary, frames = pd.DataFrame(), pd.DataFrame()

st.sidebar.header("Filter")
def filter_select(df, column, label):
    if column not in df.columns or df.empty:
        return None
    values = sorted(df[column].dropna().astype(str).unique().tolist())
    return st.sidebar.multiselect(label, values, default=values)

participants = filter_select(eval_data, "participant_id", "Responden")
camera_labels = filter_select(eval_data, "camera_label", "Kamera")
sessions = filter_select(eval_data, "test_session_id", "Sesi test")
distances = filter_select(eval_data, "distance_condition_cm", "Kondisi jarak (cm)")

def apply_filters(df):
    out = df.copy()
    for column, selected in [
        ("participant_id", participants), ("camera_label", camera_labels),
        ("test_session_id", sessions), ("distance_condition_cm", distances),
    ]:
        if selected is not None and column in out.columns:
            out = out[out[column].astype(str).isin(selected)]
    return out

summary, frames = apply_filters(summary), apply_filters(frames)
raw_filtered = raw.copy()
if participants is not None and "participant_id" in raw_filtered.columns:
    raw_filtered = raw_filtered[raw_filtered.participant_id.astype(str).isin(participants)]
raw_cam = first_col(raw_filtered, ["camera_label", "camera_id"])
if camera_labels is not None and raw_cam:
    raw_filtered = raw_filtered[raw_filtered[raw_cam].astype(str).isin(camera_labels)]

errors = frames["frame_error_deg"].dropna() if "frame_error_deg" in frames.columns else pd.Series(dtype=float)
if not errors.empty:
    mean_error = float(errors.mean())
elif "mean_error_deg" in summary.columns:
    weights = summary.get("n_valid_test_frames", pd.Series(1, index=summary.index)).fillna(1)
    valid = summary.mean_error_deg.notna() & weights.gt(0)
    mean_error = float((summary.loc[valid, "mean_error_deg"] * weights[valid]).sum() / weights[valid].sum()) if valid.any() else math.nan
else:
    mean_error = math.nan

n_people = summary.participant_id.nunique() if "participant_id" in summary.columns else 0
n_cameras = summary.camera_id.nunique() if "camera_id" in summary.columns else 0
n_sessions = summary.test_session_id.nunique() if "test_session_id" in summary.columns else 0
n_valid = int(summary.n_valid_test_frames.fillna(0).sum()) if "n_valid_test_frames" in summary.columns else len(frames)

k = st.columns(5)
k[0].metric("Responden", n_people)
k[1].metric("Kamera", n_cameras)
k[2].metric("Sesi test", n_sessions)
k[3].metric("Frame test valid", f"{n_valid:,}")
k[4].metric("Mean gaze error", f"{mean_error:.2f}°" if math.isfinite(mean_error) else "—")

if eval_data.empty:
    st.warning("Tidak ditemukan CSV evaluasi dengan record_type summary/frame. Raw acquisition tetap dapat dianalisis di bawah.")
else:
    t1, t2, t3, t4, t5 = st.tabs(["Ringkasan", "Responden", "Kamera", "Titik test", "Frame-level"])
    with t1:
        m = st.columns(2)
        if "point_hit_pct" in summary.columns:
            m[0].metric("Point hit rate rata-rata", f"{summary.point_hit_pct.mean():.1f}%" if summary.point_hit_pct.notna().any() else "—")
        if "frame_hit_pct" in summary.columns:
            m[1].metric("Frame hit rate rata-rata", f"{summary.frame_hit_pct.mean():.1f}%" if summary.frame_hit_pct.notna().any() else "—")
        color = first_col(summary, ["camera_label", "camera_id"])
        if not summary.empty and color and "mean_error_deg" in summary.columns:
            fig = px.bar(summary, x="participant_id", y="mean_error_deg", color=color, barmode="group",
                         hover_data=[c for c in ["test_session_id", "distance_condition_cm", "n_valid_test_frames"] if c in summary.columns],
                         labels={"participant_id": "Responden", "mean_error_deg": "Mean error (°)"})
            st.plotly_chart(fig, use_container_width=True)
        st.dataframe(summary, use_container_width=True, hide_index=True)
    with t2:
        if not summary.empty and "participant_id" in summary.columns:
            agg = {"mean_error_deg": "mean"}
            for c in ["point_hit_pct", "frame_hit_pct"]:
                if c in summary.columns: agg[c] = "mean"
            by_person = summary.groupby("participant_id", dropna=False).agg(agg).reset_index()
            st.dataframe(by_person, use_container_width=True, hide_index=True)
            st.plotly_chart(px.bar(by_person, x="participant_id", y="mean_error_deg",
                                  labels={"participant_id": "ID responden", "mean_error_deg": "Mean gaze error (°)"}),
                             use_container_width=True)
        else:
            st.info("Tidak ada summary pada filter ini.")
    with t3:
        camera = first_col(summary, ["camera_label", "camera_id"])
        if camera and "mean_error_deg" in summary.columns and not summary.empty:
            agg = {"mean_error_deg": ("mean_error_deg", "mean")}
            if "test_session_id" in summary.columns:
                agg["jumlah_sesi"] = ("test_session_id", "nunique")
            by_camera = summary.groupby(camera, dropna=False).agg(**agg).reset_index()
            st.plotly_chart(px.bar(by_camera, x=camera, y="mean_error_deg",
                                  labels={camera: "Kamera", "mean_error_deg": "Mean gaze error (°)"},
                                  hover_data=[c for c in ["jumlah_sesi"] if c in by_camera.columns]),
                             use_container_width=True)
            st.dataframe(by_camera, use_container_width=True, hide_index=True)
        else:
            st.info("Tidak ada summary kamera pada filter ini.")
    with t4:
        if not frames.empty and "point_id" in frames.columns:
            by_point = frames.groupby("point_id", dropna=False).agg(
                n_frames=("frame_error_deg", "count"),
                mean_error_deg=("frame_error_deg", "mean"),
                median_error_deg=("frame_error_deg", "median"),
                frame_hit_pct=("frame_hit", lambda s: 100 * bool_series(s).mean()),
            ).reset_index()
            st.plotly_chart(px.bar(by_point, x="point_id", y="mean_error_deg",
                                  labels={"point_id": "Point ID", "mean_error_deg": "Mean error (°)"},
                                  hover_data=["n_frames", "median_error_deg", "frame_hit_pct"]),
                             use_container_width=True)
            st.dataframe(by_point, use_container_width=True, hide_index=True)
        else:
            st.info("Tidak ada frame-level test evaluation.")
    with t5:
        if not frames.empty:
            if "frame_error_deg" in frames.columns:
                st.plotly_chart(px.histogram(frames, x="frame_error_deg", nbins=40,
                                            labels={"frame_error_deg": "Frame gaze error (°)"}),
                                use_container_width=True)
            if {"target_x", "target_y", "predicted_gaze_x", "predicted_gaze_y"}.issubset(frames.columns):
                fig = px.scatter(frames, x="target_x", y="target_y", color="frame_error_deg",
                                 hover_data=[c for c in ["participant_id", "camera_label", "point_id", "frame_error_deg"] if c in frames.columns],
                                 labels={"target_x": "Target X (normalized)", "target_y": "Target Y (normalized)"})
                fig.add_scatter(x=frames.predicted_gaze_x, y=frames.predicted_gaze_y, mode="markers",
                                name="Prediksi gaze", marker={"symbol": "x"})
                fig.update_yaxes(autorange="reversed")
                st.plotly_chart(fig, use_container_width=True)
            st.dataframe(frames, use_container_width=True, hide_index=True)
            st.download_button("Unduh frame evaluation terfilter", csv_bytes(frames),
                              "eye_tracking_frame_evaluation_filtered.csv", "text/csv")
        else:
            st.info("Tidak ada frame evaluation.")

st.divider()
st.header("Kualitas akuisisi dari raw CSV")
if raw_filtered.empty:
    st.info("Unggah CSV raw kalibrasi/test untuk melihat kualitas akuisisi.")
else:
    valid_col = first_col(raw_filtered, ["face_valid"])
    valid_pct = 100 * bool_series(raw_filtered[valid_col]).mean() if valid_col else math.nan
    fixation_col = first_col(raw_filtered, ["fixation_after_onset"])
    fixation_n = int(bool_series(raw_filtered[fixation_col]).sum()) if fixation_col else None
    det_mean = raw_filtered.detection_ms.mean() if "detection_ms" in raw_filtered.columns else math.nan
    q = st.columns(4)
    q[0].metric("Raw frames", f"{len(raw_filtered):,}")
    q[1].metric("Face valid", f"{valid_pct:.1f}%" if math.isfinite(valid_pct) else "—")
    q[2].metric("Fixation after onset", f"{fixation_n:,}" if fixation_n is not None else "—")
    q[3].metric("Mean detection time", f"{det_mean:.2f} ms" if math.isfinite(det_mean) else "—")

    if "participant_id" in raw_filtered.columns:
        camera = first_col(raw_filtered, ["camera_label", "camera_id"])
        group = ["participant_id"] + ([camera] if camera else [])
        agg = {"raw_frames": ("participant_id", "size")}
        if valid_col: agg["face_valid_pct"] = (valid_col, lambda s: 100 * bool_series(s).mean())
        if "detection_ms" in raw_filtered.columns: agg["mean_detection_ms"] = ("detection_ms", "mean")
        for src, dst in [
            ("measured_delivered_frame_rate_fps", "delivered_fps"),
            ("requested_frame_rate_fps", "requested_fps"),
            ("track_settings_frame_rate_fps", "actual_track_fps"),
            ("screen_width_cm", "screen_width_cm"),
            ("viewing_distance_cm", "actual_viewing_distance_cm"),
            ("requested_video_w", "requested_width_px"),
            ("requested_video_h", "requested_height_px"),
            ("track_settings_video_w", "actual_width_px"),
            ("track_settings_video_h", "actual_height_px"),
        ]:
            if src in raw_filtered.columns: agg[dst] = (src, "mean")
        raw_summary = raw_filtered.groupby(group, dropna=False).agg(**agg).reset_index()
        st.dataframe(raw_summary, use_container_width=True, hide_index=True)
        st.download_button("Unduh ringkasan kualitas akuisisi", csv_bytes(raw_summary),
                          "eye_tracking_acquisition_quality_summary.csv", "text/csv")

    if "timestamp_ms" in raw_filtered.columns and "participant_id" in raw_filtered.columns and "detection_ms" in raw_filtered.columns:
        chart = raw_filtered.copy()
        camera = first_col(chart, ["camera_label", "camera_id"])
        chart["series"] = chart.participant_id.astype(str) + (" / " + chart[camera].astype(str) if camera else "")
        st.plotly_chart(px.line(chart.sort_values("timestamp_ms"), x="timestamp_ms", y="detection_ms", color="series",
                                labels={"timestamp_ms": "Timestamp (ms)", "detection_ms": "Detection time (ms)", "series": "Responden / kamera"}),
                         use_container_width=True)
    st.dataframe(raw_filtered, use_container_width=True, hide_index=True)
    st.download_button("Unduh raw data terfilter", csv_bytes(raw_filtered),
                      "eye_tracking_raw_data_filtered.csv", "text/csv")

with st.expander("Definisi metrik dan batas interpretasi"):
    st.markdown("""
    - Gaze error (°) adalah frame_error_deg hasil aplikasi terhadap target test grid, memakai setup fisik layar/jarak sesi.
    - Point hit rate menilai median prediksi pada tiap titik test terhadap region target.
    - Frame hit rate adalah persentase frame test valid yang prediksinya berada di region target.
    - Face valid adalah proporsi frame yang lolos gatekeeper.
    - Fixation after onset menandai fixation yang dimulai setelah target muncul.
    - Bandingkan kamera pada kondisi jarak, resolusi, FPS, dan layar yang sebanding.
    - Error terhadap Tobii Spark memerlukan CSV Tobii yang dipasangkan berdasarkan timestamp; metrik ini bukan error terhadap Tobii.
    """)
