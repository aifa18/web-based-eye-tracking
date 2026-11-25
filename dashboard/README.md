# GazeLab — Eye Tracking Pilot Dashboard

Dashboard Streamlit untuk membandingkan hasil inferensi model gaze terlatih pada pilot study multi-camera.

## Prinsip penggunaan

- **Input utama:** CSV hasil inferensi/evaluasi model yang sudah dilatih.
- **Degree error:** harus berasal dari prediksi model yang dibandingkan dengan ground truth yang tersinkronisasi.
- **Raw acquisition CSV:** opsional, hanya untuk diagnostic kualitas akuisisi seperti face-valid rate, FPS, dan detection time. Raw data tidak digunakan untuk menghitung degree error atau ranking konfigurasi.
- **Best configuration:** ranking eksploratif berdasarkan mean degree error pada data yang sedang difilter. Periksa coverage prediksi, jumlah responden/frame, dan kesetaraan kondisi sebelum menyimpulkan konfigurasi terbaik.

## CSV evaluasi yang didukung

Dashboard membaca format summary/frame dengan `record_type`:
- `summary`: `mean_error_deg`, kamera, konfigurasi, jumlah frame valid, dan metrik tambahan jika tersedia.
- `frame`: `frame_error_deg`, prediksi gaze, ground truth, timestamp, point ID, serta identitas eksperimen jika tersedia.

Format frame-level tanpa `record_type` juga dapat dibaca jika memiliki `frame_error_deg`; summary tanpa `record_type` dapat dibaca jika memiliki `mean_error_deg`.

Kolom yang berguna untuk perbandingan:
`participant_id`, `camera_id` atau `camera_label`, `test_session_id`, `scenario_id`, `distance_condition_cm`, `requested_video_w`, `requested_video_h`, `requested_frame_rate_fps`, `model_version`, `predicted_gaze_x`, `predicted_gaze_y`, `target_x`, `target_y`, `frame_error_deg`, `mean_error_deg`, `n_valid_test_frames`.

## Jalankan lokal

1. Buat virtual environment: `python -m venv .venv-dashboard`
2. Aktifkan PowerShell: ` .\.venv-dashboard\Scripts\Activate.ps1` (hapus spasi awal sebelum perintah jika menyalin)
3. Install: `pip install -r dashboard/requirements.txt`
4. Jalankan: `streamlit run dashboard/app.py`
5. Buka URL lokal yang ditampilkan, biasanya http://localhost:8501.

## Status pilot

Dashboard ini adalah visualisasi hasil evaluasi, bukan runtime untuk menjalankan file model teman secara langsung. Integrasi inferensi memerlukan file model dan kontrak preprocessing/input/output yang sesuai. Belum ada klaim bahwa model teman sudah terhubung atau hasil CSV telah diuji end-to-end.

Jika dashboard di-deploy ke cloud, anonimisasi ID responden dan ikuti persetujuan serta kebijakan penyimpanan data penelitian.
