import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function TopicIndex({ topics, counts = {}, loading = false, error = false }) {
  return <div className="topic-index">
    {topics.map((topic) => <article className={`topic-index-item ${counts[topic.number] ? 'is-ready' : ''}`} key={topic.number}>
      <div className="topic-card-top"><span className="topic-status">{loading ? 'Checking' : error ? 'Unavailable' : counts[topic.number] ? 'Available' : 'Coming soon'}</span></div>
      <div className="topic-heading"><h3><Link to={`/topic/${topic.number}`}>{topic.title}</Link></h3></div>
      <p className="topic-card-description">{counts[topic.number] ? 'Browse questions by skill and paper type.' : loading ? 'Checking the question bank.' : error ? 'The question bank could not be reached.' : 'Questions will be added here.'}</p>
      <Link className="topic-link" to={`/topic/${topic.number}`}>{counts[topic.number] ? 'Explore questions' : 'View topic'} <ArrowUpRight size={16} aria-hidden="true" /></Link>
    </article>)}
  </div>
}
