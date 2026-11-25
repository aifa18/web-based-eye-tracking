# Eye Tracking Streamlit Dashboard

Dashboard analisis hasil akuisisi dan evaluasi gaze. Dashboard terpisah dari aplikasi Next.js sehingga tidak mengubah proses kalibrasi maupun skema CSV.

## Menjalankan lokal

Dari root repository:

\`\`\`bash
python -m venv .venv-dashboard
\`\`\`

Windows PowerShell:

\`\`\`powershell
.\.venv-dashboard\Scripts\Activate.ps1
pip install -r dashboard/requirements.txt
streamlit run dashboard/app.py
\`\`\`

macOS/Linux:

\`\`\`bash
source .venv-dashboard/bin/activate
pip install -r dashboard/requirements.txt
streamlit run dashboard/app.py
\`\`\`

Buka URL lokal Streamlit (biasanya http://localhost:8501), lalu unggah CSV.

## Input

- CSV evaluasi test grid test-evaluation_...csv dengan record_type summary dan frame.
- CSV raw kalibrasi/test calibration_...csv untuk face-valid, fixation, timestamp, detection time, FPS, dan metadata kamera.

Gaze error diambil dari frame_error_deg hasil evaluasi test grid. Raw calibration CSV tidak digunakan untuk menyatakan gaze error. Error terhadap Tobii Spark memerlukan data Tobii yang dipasangkan secara terpisah.

Dashboard berjalan lokal dan tidak mengirim file ke layanan eksternal. Jika di-deploy ke cloud, anonimisasi ID responden dan pastikan sesuai persetujuan serta kebijakan penyimpanan data penelitian.
