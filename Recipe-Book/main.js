document.querySelector('body').addEventListener('click', getFetch)

function getFetch(){
  const url = 'https://api.spoonacular.com/recipes/random?number=10&apiKey=5eca0db0965948358eaa56a068fc06dc'

  fetch(url)
      .then(res => res.json()) // parse response as JSON
      .then(data => {
        console.log(data)
      })
      .catch(err => {
          console.log(`error ${err}`)
      });
}
