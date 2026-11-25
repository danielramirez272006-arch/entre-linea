import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { JournalIllustration } from '../components/layout/JournalIllustration.jsx';
import { Icon } from '../components/ui/Icon.jsx';
export function Home() {
  const { user } = useAuth();
  return <div className="home-editorial anim-view">
    <section className="landing-hero"><div className="hero-copy">
      <p className="hero-eyebrow"><span className="eyebrow-line"/> TU VIDA, A TU RITMO</p>
      <h1>Hay cosas que<br/>merecen <em>quedarse.</em></h1>
      <p className="hero-lead">Un pensamiento suelto. Un día inolvidable. Eso que todavía no sabes cómo decir. Aquí hay una página para todo lo que eres.</p>
      <div className="hero-actions"><Link to={user ? '/diario' : '/registro'} className="btn btn-primary"><Icon name="pen" size={18}/>{user ? 'Volver a mi diario' : 'Empezar mi diario'}</Link>{!user && <Link to="/iniciar-sesion" className="hero-secondary">Ya tengo mi espacio</Link>}</div>
      <p className="hero-footnote"><Icon name="lock" size={15}/> Personal. Privado. Sin prisas.</p>
    </div><JournalIllustration/></section>
    <section className="ritual-strip" aria-label="Un diario a tu manera"><span>Menos ruido.<br/><strong>Más espacio para ti.</strong></span><p>No necesitas encontrar las palabras perfectas.<br/>Solo un lugar donde empezar.</p><Icon name="leaf" size={38}/></section>
    <section className="home-features" aria-labelledby="features-title"><div className="section-intro"><p className="hero-eyebrow">TU PEQUEÑO REFUGIO DIGITAL</p><h2 id="features-title">Escribir también es<br/><em>una forma de cuidarte.</em></h2></div>
      <div className="feature-grid">
        <article className="feature-card"><span className="feature-icon"><Icon name="pen"/></span><h3>Hazle espacio a tu día.</h3><p>Escribe lo que pasó, lo que sentiste o lo que te gustaría recordar. Sin formatos que te limiten.</p></article>
        <article className="feature-card"><span className="feature-icon warm"><Icon name="sun"/></span><h3>Encuentra tu propio hilo.</h3><p>Organiza recuerdos, gratitud y metas. Vuelve a tus palabras cuando necesites un poco de perspectiva.</p></article>
        <article className="feature-card"><span className="feature-icon"><Icon name="lock"/></span><h3>Lo personal sigue personal.</h3><p>Tus entradas se guardan cifradas. Otras cuentas y el panel administrativo no pueden leer tu diario.</p></article>
      </div>
    </section>
    <section className="honest-privacy" aria-labelledby="privacidad-titulo"><div className="privacy-seal"><Icon name="lock" size={30}/></div><div><p className="hero-eyebrow">PRIVACIDAD, CON CLARIDAD</p><h2 id="privacidad-titulo">Tus palabras merecen cuidado.</h2><p>Ciframos tus entradas antes de guardarlas y comprobamos que solo tu cuenta pueda acceder a ellas. El servidor las descifra para mostrártelas: no es cifrado de extremo a extremo.</p></div><Link to={user ? '/diario' : '/registro'} className="btn btn-secondary">{user ? 'Abrir mi diario' : 'Crear mi espacio'}</Link></section>
  </div>;
}
