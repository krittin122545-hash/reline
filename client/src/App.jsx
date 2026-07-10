import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [summary, setSummary] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const [summaryRes, logsRes] = await Promise.all([
          fetch('/summary'),
          fetch('/logs'),
        ])

        const summaryData = await summaryRes.json()
        const logsData = await logsRes.json()

        setSummary(summaryData)
        setLogs(logsData)
      } catch (error) {
        console.error('Failed to load data', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const totalCount = logs.length
  const userCount = summary.length
  const totalAmount = summary.reduce((sum, item) => sum + (item.amount || 0), 0)

  return (
    <div className="app">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Telegram Bot Dashboard</p>
          <h1>ReLine Dashboard</h1>
          <p className="subtitle">ดูสรุปคนรีไลน์และรายการล่าสุดจากบอท</p>
        </div>
      </header>

      {loading ? (
        <p>กำลังโหลดข้อมูล...</p>
      ) : (
        <>
          <section className="stats-grid">
            <div className="card">
              <p className="label">จำนวนรายการ</p>
              <h2>{totalCount}</h2>
            </div>
            <div className="card">
              <p className="label">จำนวนคน</p>
              <h2>{userCount}</h2>
            </div>
            <div className="card">
              <p className="label">ยอดเงิน</p>
              <h2>{totalAmount} บาท</h2>
            </div>
          </section>

          <section className="card">
            <h3>อันดับคนรีไลน์</h3>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>ชื่อ</th>
                  <th>ครั้ง</th>
                  <th>เงิน</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((item, index) => (
                  <tr key={item.telegram_id || index}>
                    <td>{index + 1}</td>
                    <td>{item.fullname || item.username || 'ไม่ทราบชื่อ'}</td>
                    <td>{item.total}</td>
                    <td>{item.amount || item.total * 50} บาท</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h3>รายการล่าสุด</h3>
            <table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ชื่อ</th>
                  <th>กลุ่ม</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 10).map((item, index) => (
                  <tr key={item.id || index}>
                    <td>{new Date(item.reline_time).toLocaleString('th-TH')}</td>
                    <td>{item.fullname || item.username || 'ไม่ทราบชื่อ'}</td>
                    <td>{item.chat_title || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}

export default App
