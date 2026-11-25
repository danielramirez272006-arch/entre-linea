import { Icon } from '../ui/Icon.jsx';
export function JournalIllustration() {
  return <div className="journal-scene" aria-label="Ilustración de una libreta; el texto es un ejemplo de escritura">
    <div className="scene-orbit" aria-hidden="true"/>
    <span className="scene-caption">Un pequeño ritual. Un espacio tuyo.</span>
    <div className="journal-book"><div className="journal-spine" aria-hidden="true"/><div className="journal-page">
      <div className="journal-page-top"><Icon name="sun"/><span>UNA PÁGINA PARA MÍ</span></div>
      <p className="journal-script">Hoy elijo<br/>ir más despacio.</p>
      <p className="journal-sample">Quiero recordar las cosas pequeñas.<br/>El café de la mañana, una buena charla,<br/>y la calma de volver a empezar.</p>
      <span className="journal-signature">Entre líneas, me encuentro.</span>
      <div className="pressed-leaf" aria-hidden="true"><Icon name="leaf" size={90}/></div>
    </div><span className="journal-ribbon" aria-hidden="true"/></div>
    <span className="scene-label"><Icon name="lock" size={16}/> Una libreta que se queda contigo</span>
    <span className="illustration-disclaimer">Texto ilustrativo</span>
  </div>;
}
