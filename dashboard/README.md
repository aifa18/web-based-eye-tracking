Eye Tracking Streamlit Dashboard

Dashboard analisis hasil akuisisi dan evaluasi gaze. Aplikasi ini terpisah dari Next.js sehingga tidak mengubah proses kalibrasi atau skema CSV.

Menjalankan lokal dari root repository:

1. Buat virtual environment: python -m venv .venv-dashboard
2. Aktifkan di PowerShell: .\.venv-dashboard\Scripts\Activate.ps1 (macOS/Linux: source .venv-dashboard/bin/activate)
3. Pasang dependensi: pip install -r dashboard/requirements.txt
4. Jalankan: streamlit run dashboard/app.py
5. Buka URL Streamlit yang muncul, biasanya http://localhost:8501.

Input: CSV test-evaluation dengan record_type summary/frame, serta CSV raw calibration/test untuk kualitas akuisisi. Gaze error diambil dari frame_error_deg hasil test grid. Raw calibration CSV tidak digunakan sebagai gaze error. Error terhadap Tobii Spark memerlukan data Tobii yang dipasangkan secara terpisah.

Dashboard berjalan lokal dan tidak mengirim file ke layanan eksternal. Jika di-deploy ke cloud, anonimisasi ID responden dan pastikan sesuai persetujuan serta kebijakan penyimpanan data penelitian.
